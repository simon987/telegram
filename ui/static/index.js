let dateRange = [-1, -1];
let contextMessage;
let output;

function formatDate(date) {
    return date.toISOString().slice(0, 10)
}

window.onload = function () {
    output = document.getElementById("output");

    let slider = document.getElementById("date-slider");
    noUiSlider.create(slider, {
        range: {
            min: new Date("2016").getTime(),
            max: new Date().getTime()
        },

        step: 24 * 60 * 60 * 1000,

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
        dateValues[handle].innerHTML = formatDate(new Date(+values[handle]));
        dateRange[handle] = Math.round(new Date(+values[handle]).getTime() / 1000);
    });

    const instances = M.FormSelect.init(document.querySelectorAll('select'), {});
};

function clearResults() {
    while (output.hasChildNodes()) {
        output.removeChild(output.lastChild);
    }
}

function appendResults(hits) {
    for (let i = 0; i < hits.length; i++) {
        output.appendChild(createTelegramMessage(hits[i]));
    }
}

function prependResults(hits) {
    for (let i = 0; i < hits.length; i++) {
        output.prepend(createTelegramMessage(hits[i]));
    }
}

function decorateMessage(message, query) {

    if (!message) {
        return null;
    }

    if (query) {
        query.split(" ").filter(token => token.length > 2).forEach(token => {
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

function addLoadMoreButton(output, query, direction) {
    if (direction === "down") {
        output.appendChild(createButton("Load more results", "waves-effect waves-light btn",
            function () {

                // Move button to end
                const btn = output.lastChild;
                btn.remove();

                const preloader = createPreloader();
                output.appendChild(preloader);

                query.from += query.size;
                if (Object.keys(query.query.bool.filter[0].range)[0] === "date") {
                    query.query.bool.filter[0].range.date.lte += 900000;
                }
                queryES(query, function (elasticResponse) {
                    appendResults(elasticResponse["hits"]["hits"], output);
                    preloader.remove();
                    if (elasticResponse["hits"]["hits"].length > 0) {
                        output.appendChild(btn);
                    }
                });
            }));
    } else {
        output.prepend(createButton("Load more results", "waves-effect waves-light btn",
            function () {

                const btn = output.firstChild;
                btn.remove();

                const preloader = createPreloader();
                output.prepend(preloader);

                query.from += query.size;
                if (Object.keys(query.query.bool.filter[0].range)[0] === "date") {
                    query.query.bool.filter[0].range.date.gte -= 900000;
                }
                queryES(query, function (elasticResponse) {
                    prependResults(elasticResponse["hits"]["hits"], output);
                    preloader.remove();
                    if (elasticResponse["hits"]["hits"].length > 0) {
                        output.prepend(btn);
                    }
                });
            }));
    }
}

function onSubmit() {

    const sort = document.getElementById("sort").value;
    const sortOrder = document.getElementById("sort-order").checked ? "asc" : "desc";

    let query = {
        query: {
            bool: {
                must: [],
                filter: [
                    {range: {date: {gte: dateRange[0], lte: dateRange[1]}}}
                ]
            }
        },
        "sort": [
            {[sort]: sortOrder},
            {"_id": "asc"},
        ],
        size: 25,
        from: 0
    };

    const message = document.getElementById("search").value;
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
    const author = document.getElementById("author").value;
    if (author) {
        query.query.bool.filter.push({"match": {"post_author": author}})
    }

    const channel = document.getElementById("channel").value;
    if (channel) {
        query.query.bool.filter.push({"match": {"channel_name": channel}})
    }

    const output = document.getElementById("output");

    clearResults();
    let preloader = createPreloader();
    output.appendChild(preloader);

    queryES(query, function (elasticResponse) {
        preloader.remove();

        output.appendChild(createHeader(`${elasticResponse["hits"]["total"]["value"]} messages`));
        appendResults(elasticResponse["hits"]["hits"], output);

        if (elasticResponse["hits"]["hits"].length < elasticResponse["hits"]["total"]["value"]) {
            addLoadMoreButton(output, query, "down")
        }
    });

    // Don't trigger page reload!
    return false;
}

function queryES(query, cb) {

    const base_url = "https://dev.pushshift.io/telegram/_search";
    const url = base_url + `?source_content_type=application/json&source=${JSON.stringify(query)}`;

    const xmlHttp = new XMLHttpRequest();
    xmlHttp.open("GET", url, true);
    xmlHttp.onreadystatechange = function () {
        if (xmlHttp.readyState === 4) {
            if (xmlHttp.status === 200) {
                const response = JSON.parse(xmlHttp.responseText);
                console.log(response);
                cb(response)
            } else {
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
    if (contextMessage === hit["_id"]) {
        message.classList.add("context-message");
        window.setTimeout(function() {
            message.scrollIntoView()
        }, 1000);
    }

    message.appendChild(createTelegramUserPic(hit));
    message.appendChild(createTelegramMessageBody(hit));

    message.appendChild(createButton("context", "btn btn-xsmall pull_right action-btn",
        function () {
            contextMessage = hit["_id"];
            clearResults(output);
            let preloader = createPreloader();
            output.appendChild(preloader);

            const query = {
                query: {
                    bool: {
                        must: [],
                        filter: [
                            {range: {date: {gte: hit["_source"]["date"] - 60, lte: hit["_source"]["date"] + 60}}},
                            {"match": {"channel_name": hit["_source"]["channel_name"]}}
                        ]
                    }
                },
                "sort": [
                    {"date": "asc"}
                ],
                size: 20,
                from: 0
            };

            queryES(query, function (elasticResponse) {

                appendResults(elasticResponse["hits"]["hits"]);
                preloader.remove();

                let upQuery = JSON.parse(JSON.stringify(query));
                upQuery.sort[0].date = "desc";

                addLoadMoreButton(document.getElementById("output"), query, "down");
                addLoadMoreButton(document.getElementById("output"), upQuery, "up");
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
        onSubmit();
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
            onSubmit();
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
    userPic.setAttribute("style", "width: 42px; height: 42px");

    const initials = document.createElement("div");
    initials.setAttribute("class", "initials");
    initials.setAttribute("style", "line-height: 42px");

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
