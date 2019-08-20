// TODO: make something with the header
// TODO: media files

//Constants
const QUERY_SIZE = 20;
const AUTOCOMPLETE_DEBOUNCE = 500;

let state = {
    dateRange: [0, 0],
    inContextMessageId: "",
    lastQuery: {
        "up": null,
        "down": null,
    },
    lastResponse: null,
};

let OUTPUT_DIV;

function autocompleteFunc(CHANNEL_ELEM, channel_auto, field) {
    return function () {
        const text = CHANNEL_ELEM.value;

        if (text.length >= 2) {
            fetchAutoComplete(text, field, function (hits) {
                let data = {};
                hits.forEach(hit => {
                    data[hit] = null;
                });
                channel_auto.updateData(data);
                window.setTimeout(() => channel_auto.open(), 100);
            })
        } else {
            channel_auto.updateData({});
            channel_auto.close();
        }
    };
}

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

    slider.noUiSlider.on('update', (values, handle) => {
        dateValues[handle].innerHTML = (new Date(+values[handle])).toISOString().slice(0, 10);
        state.dateRange[handle] = Math.round(new Date(+values[handle]).getTime() / 1000);
    });

    // Materialize: init elements
    M.FormSelect.init(document.querySelectorAll("select"), {});

    const CHANNEL_ELEM = document.getElementById("channel");
    M.Autocomplete.init(CHANNEL_ELEM, {});
    const channel_auto = M.Autocomplete.getInstance(CHANNEL_ELEM);
    CHANNEL_ELEM.addEventListener(
        "keypress",
        debounce(autocompleteFunc(CHANNEL_ELEM, channel_auto, "channel_name"), AUTOCOMPLETE_DEBOUNCE)
    );

    const AUTHOR_ELEM = document.getElementById("author");
    M.Autocomplete.init(AUTHOR_ELEM, {});
    const author_auto = M.Autocomplete.getInstance(AUTHOR_ELEM);
    AUTHOR_ELEM.addEventListener(
        "keypress",
        debounce(autocompleteFunc(AUTHOR_ELEM, author_auto, "post_author"), AUTOCOMPLETE_DEBOUNCE)
    );
};


// Util functions

// From underscore.js
function debounce(func, wait) {
    let timeout;
    return function () {
        let context = this, args = arguments;
        let later = function () {
            timeout = null;
            func.apply(context, args);
        };
        let callNow = !timeout;
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
        if (callNow) func.apply(context, args);
    };
}

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
                    message = message.replace(new RegExp(`(${token})`, "ig"), "<mark>$1</mark>")
                }
            );
    }

    // Make links clickable, but remove the 'mark' tags in the href
    message = message.replace(
        new RegExp('(https?://[\\w_-]+.[a-z]{2,4}([^\\s"]*|$))', "ig"),
        (match, g1) => {
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
    hits.map(hit => createTelegramMessage(hit))
        .forEach(elem => OUTPUT_DIV.appendChild(elem))
}

function prependResults(hits) {
    hits.map(hit => createTelegramMessage(hit))
        .forEach(elem => OUTPUT_DIV.prepend(elem))
}

function addLoadMoreButton(mutateQueryFunc, direction) {

    const removePrevButton = direction === "up"
        ? () => OUTPUT_DIV.firstChild.remove()
        : () => OUTPUT_DIV.lastChild.remove();
    const addButton = direction === "up"
        ? btn => OUTPUT_DIV.prepend(btn)
        : btn => OUTPUT_DIV.appendChild(btn);

    const onClick = function () {
        removePrevButton();
        addPreloader(direction);

        mutateQueryFunc(state.lastQuery[direction]);

        queryES(state.lastQuery[direction], function (elasticResponse) {
            removePreloader();

            if (direction === "up") {
                prependResults(elasticResponse["hits"]["hits"]);
            } else {
                appendResults(elasticResponse["hits"]["hits"]);
            }

            if (elasticResponse["hits"]["hits"].length > 0) {
                addLoadMoreButton(mutateQueryFunc, direction);
            }
        });
    };

    addButton(createButton("Load more results", "waves-effect waves-light btn", onClick));
}

function addPreloader(direction) {
    const preloader = createPreloader();

    if (direction === "up") {
        OUTPUT_DIV.prepend(preloader);
    } else {
        OUTPUT_DIV.appendChild(preloader);
    }
}

function removePreloader() {
    Array.from(OUTPUT_DIV.getElementsByClassName("progress"))
        .forEach(elem => elem.remove());
}

function onFormSubmit() {

    state.inContextMessageId = null;
    state.lastQuery.up = null;
    state.lastQuery.down = null;

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
        query.query.bool.filter.push({"term": {"post_author.keyword": author}})
    }
    if (channel) {
        query.query.bool.filter.push({"term": {"channel_name.keyword": channel}})
    }

    clearResults();
    addPreloader();

    state.lastQuery.down = query;
    queryES(query, function (elasticResponse) {
        removePreloader();

        //TODO: move header outside of #output
        //OUTPUT_DIV.appendChild(createHeader(`${elasticResponse["hits"]["total"]["value"]} messages`));
        appendResults(elasticResponse["hits"]["hits"]);

        if (elasticResponse["hits"]["hits"].length < elasticResponse["hits"]["total"]["value"]) {
            addLoadMoreButton(query => query.from += query.size,
                "down")
        }
    });

    // Don't trigger page reload!
    return false;
}

function fetchAutoComplete(text, field, cb) {
    queryES({
        query: {
            multi_match: {
                query: text,
                type: "bool_prefix",
                fields: [
                    field,
                    field + "._2gram",
                    field + "._3gram"
                ]
            }
        },
        aggs: {
            top_results: {
                terms: {
                    field: field + ".keyword",
                },
                aggs: {
                    top_results_hits: {
                        top_hits: {
                            sort: [
                                {"_score": {"order": "desc"}}
                            ],
                            "size": 1
                        }
                    }
                }
            }
        },
        size: 0
    }, function (elasticResponse) {
        cb(elasticResponse["aggregations"]["top_results"]["buckets"].map(bucket => bucket["key"]))
    })
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
                state.lastResponse = response;
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

function doInContextSearchFunc(hit) {
    return function () {
        state.inContextMessageId = hit["_id"];
        clearResults(OUTPUT_DIV);
        addPreloader();

        const query = {
            query: {
                bool: {
                    must: [],
                    filter: [
                        {range: {date: {lte: hit["_source"]["date"]}}},
                        {"term": {"channel_name.keyword": hit["_source"]["channel_name"]}}
                    ]
                }
            },
            "sort": [
                {"date": "desc"}
            ],
            size: QUERY_SIZE / 2,
            from: 0
        };

        queryES(query, function (elasticResponse) {

            appendResults(elasticResponse["hits"]["hits"]);
            removePreloader();

            state.lastQuery.down = query;
            state.lastQuery.up = clone(query);
            state.lastQuery.up.sort[0].date = "asc";
            state.lastQuery.up.query.bool.filter[0].range.date.gt = hit["_source"]["date"];
            delete state.lastQuery.up.query.bool.filter[0].range.date.lte;
            state.lastQuery.up.from = -query.size;
            console.log("up query: " + hit["_id"]);

            addLoadMoreButton(q => q.from += q.size, "down");
            addLoadMoreButton(q => q.from += q.size, "up");
        })
    }
}

function createTelegramMessage(hit) {

    const message = document.createElement("div");
    message.setAttribute("class", "message clearfix card");

    if (state.inContextMessageId === hit["_id"]) {
        message.classList.add("context-message");
    }

    message.appendChild(createTelegramUserPic(hit));
    message.appendChild(createTelegramMessageBody(hit));

    message.appendChild(createButton("context",
        "btn btn-xsmall pull_right action-btn",
        doInContextSearchFunc(hit)
    ));

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
