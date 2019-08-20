//Constants
const QUERY_SIZE = 20;

let state = {
    dateRange: [0, 0],
    inContextMessageId: "",
};

let OUTPUT_DIV;

window.onload = function () {
    OUTPUT_DIV = document.getElementById("output");

    let slider = document.getElementById("date-slider");
    noUiSlider.create(slider, {
        range: {
            min: new Date("2016").getTime(),
            max: new Date().getTime()
        },

        step: 24 * 3600 * 1000,

        start: [new Date("2016").getTime(), new Date().getTime()],

        format: wNumb({
            decimals: 0
        })
    });

    const dateValues = [
        document.getElementById('event-start'),
        document.getElementById('event-end')
    ];

    slider.noUiSlider.on('update', function (values, handle) {
        dateValues[handle].innerHTML = (new Date(+values[handle])).toISOString().slice(0, 10);
        state.dateRange[handle] = Math.round(new Date(+values[handle]).getTime() / 1000);
    });

    // Materialize: init 'select' elements
    M.FormSelect.init(document.querySelectorAll('select'), {});
};


// Util functions
function clone(query) {
    //TODO: Is there a more elegant way to do this?
    return JSON.parse(JSON.stringify(query));
}
function decorateMessage(message, query) {

    if (!message) {
        return null;
    }

    if (query) {
        query.split(/\s+/)
            //Remove chars used in simple_query_string
            .map(token => token.replace(/^[\s()|+\-"*~]+|[\s()|+\-"*~]+$/gm, ""))
            .filter(token => token.length > 2)
            .forEach(token => {
                message = message.replace(new RegExp(`(${token})`, "ig"), "<mark>$1</mark>"
                )
            });
    }

    // Make links clickable, but remove the 'mark' tags in the href
    message = message.replace(
        new RegExp('(https?://[\\w_-]+.[a-z]{2,4}([^\\s"]*|$))', "ig"),
        function (match, g1) {
            return `<a href=\"${g1.replace(/<\/?mark>/g, "")}\">${g1}</a>`
        }
    );

    return message;
}

// ----------

function clearResults() {
    while (OUTPUT_DIV.hasChildNodes()) {
        OUTPUT_DIV.removeChild(OUTPUT_DIV.lastChild);
    }
}

function appendResults(hits) {
    for (let i = 0; i < hits.length; i++) {
        OUTPUT_DIV.appendChild(createTelegramMessage(hits[i]));
    }
}

function prependResults(hits) {
    for (let i = 0; i < hits.length; i++) {
        OUTPUT_DIV.prepend(createTelegramMessage(hits[i]));
    }
}

function addLoadMoreButton(query, direction) {
    //TODO: refac
    if (direction === "down") {
        OUTPUT_DIV.appendChild(createButton("Load more results", "waves-effect waves-light btn",
            function () {

                // Move button to end
                const btn = OUTPUT_DIV.lastChild;
                btn.remove();

                const preloader = createPreloader();
                OUTPUT_DIV.appendChild(preloader);

                query.from += query.size;
                //TODO: remove this hack
                if (Object.keys(query.query.bool.filter[0].range)[0] === "date") {
                    query.query.bool.filter[0].range.date.lte += 900000;
                }
                queryES(query, function (elasticResponse) {
                    appendResults(elasticResponse["hits"]["hits"]);
                    preloader.remove();
                    if (elasticResponse["hits"]["hits"].length > 0) {
                        OUTPUT_DIV.appendChild(btn);
                    }
                });
            }));
    } else {
        OUTPUT_DIV.prepend(createButton("Load more results", "waves-effect waves-light btn",
            function () {

                const btn = OUTPUT_DIV.firstChild;
                btn.remove();

                const preloader = createPreloader();
                OUTPUT_DIV.prepend(preloader);

                query.from += query.size;
                if (Object.keys(query.query.bool.filter[0].range)[0] === "date") {
                    query.query.bool.filter[0].range.date.gte -= 900000;
                }
                queryES(query, function (elasticResponse) {
                    prependResults(elasticResponse["hits"]["hits"]);
                    preloader.remove();
                    if (elasticResponse["hits"]["hits"].length > 0) {
                        OUTPUT_DIV.prepend(btn);
                    }
                });
            }));
    }
}

function onFormSubmit() {

    const sort = document.getElementById("sort").value;
    const sortOrder = document.getElementById("sort-order").checked ? "asc" : "desc";
    const message = document.getElementById("search").value;
    const author = document.getElementById("author").value;
    const channel = document.getElementById("channel").value;
    const minDate = state.dateRange[0];
    const maxDate = state.dateRange[1];

    let query = {
        query: {
            bool: {
                must: [],
                filter: [
                    {range: {date: {gte: minDate, lte: maxDate}}}
                ]
            }
        },
        "sort": [
            {[sort]: sortOrder},
            {"_id": "asc"},
        ],
        size: QUERY_SIZE,
        from: 0
    };

    if (message) {
        query.query.bool.must.push(
            {
                simple_query_string: {
                    query: message,
                    fields: ["message"],
                    default_operator: "and"
                }
            }
        );
    }
    if (author) {
        query.query.bool.filter.push({"match": {"post_author": author}})
    }
    if (channel) {
        query.query.bool.filter.push({"match": {"channel_name": channel}})
    }

    clearResults();

    let preloader = createPreloader();
    OUTPUT_DIV.appendChild(preloader);

    queryES(query, function (elasticResponse) {
        preloader.remove();

        //TODO: move header outside of #output
        OUTPUT_DIV.appendChild(createHeader(`${elasticResponse["hits"]["total"]["value"]} messages`));
        appendResults(elasticResponse["hits"]["hits"]);

        if (elasticResponse["hits"]["hits"].length < elasticResponse["hits"]["total"]["value"]) {
            addLoadMoreButton(query, "down")
        }
    });

    // Don't trigger page reload!
    return false;
}

function queryES(query, cb) {

    const url = `https://dev.pushshift.io/telegram/_search?source_content_type=application/json&source=${JSON.stringify(query)}`;

    const xmlHttp = new XMLHttpRequest();
    xmlHttp.open("GET", url, true);
    xmlHttp.onreadystatechange = function () {
        if (xmlHttp.readyState === 4) {
            if (xmlHttp.status === 200) {
                const response = JSON.parse(xmlHttp.responseText);
                console.log(response);
                cb(response)
            } else {
                // TODO: Display error in toast or something
                console.log("HTTP request error:");
                console.log(xmlHttp);
            }
        }
    };
    xmlHttp.send(null);
}

function createHeader(text) {
    const el = document.createElement('h5');
    el.appendChild(document.createTextNode(text));
    return el;
}

function createTelegramMessage(hit) {

    const message = document.createElement("div");
    message.setAttribute("class", "message clearfix card");

    // If the message is the 'inContextMessage', apply custom CSS and scroll into it
    if (state.inContextMessageId === hit["_id"]) {
        message.classList.add("context-message");
        window.setTimeout(function () {
            message.scrollIntoView()
        }, 1000);
    }

    message.appendChild(createTelegramUserPic(hit));
    message.appendChild(createTelegramMessageBody(hit));

    message.appendChild(createButton("context", "btn btn-xsmall pull_right action-btn",
        function () {
            state.inContextMessageId = hit["_id"];
            clearResults(OUTPUT_DIV);
            let preloader = createPreloader();
            OUTPUT_DIV.appendChild(preloader);

            const query = {
                query: {
                    bool: {
                        must: [],
                        filter: [
                            //TODO: Remove this date hack and use search_after
                            {range: {date: {gte: hit["_source"]["date"] - 60, lte: hit["_source"]["date"] + 60}}},
                            {"match": {"channel_name": hit["_source"]["channel_name"]}}
                        ]
                    }
                },
                "sort": [
                    {"date": "desc"}
                ],
                size: QUERY_SIZE,
                from: 0
            };

            queryES(query, function (elasticResponse) {

                appendResults(elasticResponse["hits"]["hits"]);
                preloader.remove();

                let upQuery = clone(query);
                upQuery.sort[0].date = "desc";

                addLoadMoreButton(query, "down");
                addLoadMoreButton(upQuery, "up");
            })
        }));

    return message;
}

function createTelegramMessageBody(hit) {
    const messageBody = document.createElement("div");
    messageBody.setAttribute("class", "body");

    const dateDetails = document.createElement("div");
    dateDetails.setAttribute("class", "pull_right date details");
    const date = new Date(hit["_source"]["date"] * 1000);
    dateDetails.setAttribute("title", date.toISOString());

    dateDetails.appendChild(document.createTextNode(moment(date).fromNow()));

    const fromName = document.createElement("div");
    fromName.setAttribute("class", "from-name");
    fromName.setAttribute("title", "Search for this channel");
    fromName.onclick = function () {
        document.getElementById("channel").value = hit["_source"]["channel_name"];
        document.getElementById("channel-label").classList.add("active");
        onFormSubmit();
    };

    if (hit["_source"]["post_author"]) {
        fromName.appendChild(document.createTextNode(
            hit["_source"]["channel_name"] + ": "));

        const authorName = document.createElement("span");
        authorName.setAttribute("class", "author-name");
        authorName.setAttribute("title", "Search for this author");
        authorName.appendChild(document.createTextNode(hit["_source"]["post_author"]));

        authorName.onclick = function (e) {
            e.stopPropagation();
            document.getElementById("author").value = hit["_source"]["post_author"];
            document.getElementById("author-label").classList.add("active");
            onFormSubmit();
            return false;
        };
        fromName.appendChild(authorName);
    } else {
        fromName.appendChild(document.createTextNode(hit["_source"]["channel_name"]));
    }

    const text = document.createElement("div");
    text.setAttribute("class", "text");
    const query = document.getElementById("search").value;
    const msg = decorateMessage(hit["_source"]["message"], query);
    text.insertAdjacentHTML("afterbegin", msg);

    //TODO: Media files?

    messageBody.appendChild(dateDetails);
    messageBody.appendChild(fromName);
    messageBody.appendChild(text);

    return messageBody;
}

function createTelegramUserPic(hit) {
    const userPicWrap = document.createElement("div");
    userPicWrap.setAttribute("class", "pull_left userpic_wrap");

    const userPic = document.createElement("dic");
    userPic.setAttribute("class", "userpic");

    const initials = document.createElement("div");
    initials.setAttribute("class", "initials");

    if (hit["_source"]["post_author"]) {
        initials.setAttribute("title", hit["_source"]["post_author"]);
        initials.appendChild(document.createTextNode(hit["_source"]["post_author"][0].toUpperCase()));
    } else {
        initials.setAttribute("title", hit["_source"]["channel_name"]);
        initials.appendChild(document.createTextNode(hit["_source"]["channel_name"][0].toUpperCase()));
    }

    userPicWrap.appendChild(userPic);
    userPic.appendChild(initials);

    return userPicWrap;
}

function createPreloader() {
    const el = document.createElement('div');
    el.setAttribute('class', 'progress');
    const indeterminate = document.createElement('div');
    indeterminate.setAttribute('class', 'indeterminate');
    el.appendChild(indeterminate);
    return el;
}

function createButton(text, classList, cb) {
    const btnWrapper = document.createElement("div");
    btnWrapper.setAttribute("class", "btn-wrapper");

    const button = document.createElement("a");
    button.setAttribute("class", classList);
    button.appendChild(document.createTextNode(text));
    button.onclick = cb;

    btnWrapper.appendChild(button);

    return btnWrapper;
}
