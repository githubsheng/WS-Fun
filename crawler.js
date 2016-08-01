'use strict';

var https = require('https');

//utility function to run a generator. it calls `next` of the iterator whenever it sees fit (ie. promise returned from previous yield statement resolves)
function runGenerator(genFunc, param) {

    let iterator = genFunc(param);
    let result;

    function iterate(value) {
        result = iterator.next(value);
        if (!result.done)
            result.value instanceof Promise ? result.value.then(iterate, reject) : iterate(result.value);
    }

    function reject(reason) {
        console.log(reason);
        throw new Error(reason);
    }

    iterate();

}

//crawl https://www.instagram.com/9gag/ to get the posts. post information is passed to `postProcessor` when it is available.
function* crawl(postProcessor) {

    //goes to https://www.instagram.com/9gag/ to get cookies.
    let rawRet = yield sendInitRequest();
    let cookies = getCookies(rawRet.headers); //cookies include csrf token and session id

    //the first 12 posts on instgram are embedded in its html page rather than fetched via ajax calls.
    //to get these posts would require parsing the html page. its totally doable, but I will just skip the first 12 posts here
    //for simplicity.
    //here I parse the html page to get the cursor. I will need this cursor to initiate subsequent ajax requests to get more posts.
    let endCursor = extractInitEndCursor(rawRet.body);

    //to keep track of how many ajax calls have been made. I will need to make 20 ajax calls to fetch 240 posts (each gives 12 posts)
    let count = 0;
    //just in case server says there is no more posts.
    let hasNext = true;

    while(count++ < 20 && hasNext) {
        rawRet = yield fetchPostInfos(endCursor, cookies);
        let ret = JSON.parse(rawRet.body);
        let posts = ret.media.nodes;
        //data returned here does not include video url if the post contains video, i will have to make another separate ajax call to get the video url.
        posts.forEach(post => post.is_video ? fetchVideoPostInfo(post.code, cookies, postProcessor) : postProcessor(post));
        endCursor = ret.media.page_info.end_cursor;
        hasNext = ret.media.page_info.has_next_page;
    }

}

//extract the cookies from headers and store them as properties in the returned object, cookie key becomes the property name and cookie value becomes property value.
function getCookies(headers){

    let cookies = {};

    headers['set-cookie'].forEach(function(cookie){
        var p = cookie.split(';', 2)[0].split('='); //get rid of cookie attributes which are irrelevant for the server side like expires, path, and so on.
        cookies[p[0]] = p[1];
    });

    return cookies;

}

//simple regex to extract the end_cursor from page returned by https://www.instagram.com/9gag/
function extractInitEndCursor(htmlStr){
    return htmlStr.match(/"end_cursor"\s*:\s*"(\d+)"/i)[1];
}

function sendInitRequest(){

    var options = {
        protocol: 'https:',
        hostname: 'www.instagram.com',
        path: '/9gag/',
        method: 'GET'
    };

    return sendRequest(options);

}

//fetch 12 posts. however, video url in video related posts is missing.
function fetchPostInfos(previousEndCursor, cookies) {

    var postData = `q=ig_user(259220806)+%7B+media.after(${previousEndCursor}%2C+12)+%7B%0A++count%2C%0A++nodes+%7B%0A++++caption%2C%0A++++code%2C%0A++++comments+%7B%0A++++++count%0A++++%7D%2C%0A++++date%2C%0A++++dimensions+%7B%0A++++++height%2C%0A++++++width%0A++++%7D%2C%0A++++display_src%2C%0A++++id%2C%0A++++is_video%2C%0A++++likes+%7B%0A++++++count%0A++++%7D%2C%0A++++owner+%7B%0A++++++id%0A++++%7D%2C%0A++++thumbnail_src%2C%0A++++video_views%0A++%7D%2C%0A++page_info%0A%7D%0A+%7D&ref=users%3A%3Ashow`;
    var options = {
        protocol: 'https:',
        hostname: 'www.instagram.com',
        path: '/query/',
        method: 'POST',
        headers: getCommonHeaders(cookies)
    };
    options.headers['Content-Length'] = Buffer.byteLength(postData);

    return sendRequest(options, postData);
}

//fetch the complete information of a video post.
function fetchVideoPostInfo(postId, cookies, postProcessor /* callback to process the information of the video post */){

    var options = {
        protocol: 'https:',
        hostname: 'www.instagram.com',
        path: `/p/${postId}/?taken-by=9gag&__a=1`,
        method: 'GET',
        headers: getCommonHeaders(cookies)
    };

    function resolve(rawRet){
        let ret = JSON.parse(rawRet.body);
        postProcessor(ret.media);
    }

    sendRequest(options).then(resolve);

}

//set the common headers used by various ajax calls, based on cookie information.
function getCommonHeaders(cookies){

    return {
        'origin': 'https://www.instagram.com',
        'accept-language': 'en-US,en;q=0.8,zh-CN;q=0.6',
        'x-requested-with': 'XMLHttpRequest',
        'cookie': `csrftoken=${cookies.csrftoken}; s_network=; sessionid=${cookies.sessionid}; mid=${cookies.mid};`,
        'x-csrftoken': `${cookies.csrftoken}`,
        'pragma': 'no-cache',
        'x-instagram-ajax': '1',
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/51.0.2704.106 Safari/537.36',
        'content-type': 'application/x-www-form-urlencoded',
        'accept': '*/*',
        'cache-control': 'no-cache',
        'authority': 'www.instagram.com',
        'referer': 'https://www.instagram.com/9gag/'
    };

}

//a utility function to send out requests. returns a promise, and the promise resolves when the response is available.
function sendRequest(options, postData){

    return new Promise(function(resolve){
        var req = https.request(options, (res) => {

            var ret = "";

            res.on('data', data => ret += data);

            res.on('end', ()=> {
                resolve({
                    headers: res.headers,
                    body: ret
                })
            });

        });

        req.on('error', e => console.log(`problem with request: ${e.message}`));

        if(postData) req.write(postData);

        req.end();
    });

}

exports.crawlInstgram = postProcessor => runGenerator(crawl, postProcessor);