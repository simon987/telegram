let dateRange = [-1, -1];


function formatDate(date) {
    return date.toISOString().slice(0, 10)
}

window.onload = function () {
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

};

function clearResults(output) {
    while (output.hasChildNodes()) {
        output.removeChild(output.lastChild);
    }
}

function displayResults(hits, output) {
    for (let i = 0; i < hits.length; i++) {
        output.appendChild(createTelegramMessage(hits[i]));
    }
}

function onSubmit() {

    let query = {
        query: {
            bool: {
                must: [
                ],
                filter: [
                    {range: {date: {gte: dateRange[0], lte: dateRange[1]}}}
                ]
            }
        },
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

    clearResults(output);
    output.appendChild(createPreloader());

    console.log(query);
    queryES(query, function (elasticResponse) {
        const hits = elasticResponse["hits"]["hits"];

        clearResults(output);

        output.appendChild(createHeader(`${elasticResponse["hits"]["total"]["value"]} messages`));
        displayResults(elasticResponse["hits"]["hits"], output);

        // 'Load more' Button
        if (hits.length < elasticResponse["hits"]["total"]["value"]) {
            output.appendChild(createButton("Load more results", function () {

                // Move button to end
                const btn = output.lastChild;
                btn.remove();

                const preloader = createPreloader();
                output.appendChild(preloader);

                query.from += query.size;
                queryES(query, function (elasticResponse) {
                    displayResults(elasticResponse["hits"]["hits"], output);
                    preloader.remove();
                    output.appendChild(btn);
                });
            }))
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
    message.setAttribute("class", "message clearfix");

    message.appendChild(createTelegramUserPic(hit));
    message.appendChild(createTelegramMessageBody(hit));

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
    fromName.setAttribute("class", "from_name");

    if (hit["_source"]["post_author"]) {
        fromName.appendChild(document.createTextNode(
            hit["_source"]["channel_name"] + " : " + hit["_source"]["post_author"]));
    } else {
        fromName.appendChild(document.createTextNode(hit["_source"]["channel_name"]));
    }

    const text = document.createElement("div");
    text.setAttribute("class", "text");
    text.appendChild(document.createTextNode(hit["_source"]["message"]));

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

function createButton(text, cb) {
    const btnWrapper = document.createElement("div");
    btnWrapper.setAttribute("class", "btn-wrapper");

    const button = document.createElement("a");
    button.setAttribute("class", "waves-effect waves-light btn");
    button.appendChild(document.createTextNode(text));
    button.onclick = cb;

    btnWrapper.appendChild(button);

    return btnWrapper;
}
