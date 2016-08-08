/**
 * Created by wangsheng on 22/7/16.
 */

"use strict";
let crawler = require("./crawler");
let redisClient = createRedisClient();

//get connection of redis
function createRedisClient() {

    let client = require("redis").createClient();
    client.on("error", error => console.log(error));
    return client;

}

//configure and start the server.
function startServer() {
    var compression = require('compression');
    let express = require('express');
    let app = express();

    //use gzip compression if possible
    app.use(compression());
    //serve static files.
    app.use(express.static("public"));
    //use ejs as template engine.
    app.set('views', './views');
    app.set('view engine', 'ejs');

    //render the page.
    //this function embeds the first batch of data (first 10 posts) inside html to avoid another round trip of ajax.
    app.get('/', function (req, res) {

        let sendError = getDefaultRedisReadFailureHanlder(res);
        let renderPage = posts => res.render("home", {initData: JSON.stringify(posts)});

        readPostsFromRedis("sortedByLikes", 0, renderPage, sendError);

    });

    app.get('/query', function (req, res) {

        let sortBy = req.query.sortBy;
        let start = +(req.query.start);

        let sendError = getDefaultRedisReadFailureHanlder(res);
        let sendResponse = posts => res.send({posts:posts, next: start + 10});

        readPostsFromRedis(sortBy, start, sendResponse, sendError);

    });

    app.get("/pin", function(req, res){
        let postId = req.query.postId;
        redisClient.hgetall(postId, (err, post) => {
            if(err) {
                res.status(400).end();
                return;
            }
            pinPost(post);
            res.send('OK');
        });
    });

    app.get("/unpin", function(req, res){
        let postId = req.query.postId;
        redisClient.hgetall(postId, (err, post) => {
            if(err) {
                res.status(400).end();
                return;
            }
            unpinPost(post);
            res.send('OK');
        });
    });

    function getDefaultRedisReadFailureHanlder(res){

        return () => res.status(500).send({error: "oops! code challenge failed!"});

    }

    function readPostsFromRedis(sortBy, start, success, fail) {

        //get the list of post ids, and then use the ids to fetch the complete information about each post.
        //when all information about all posts are gathered, call the passed in callback `success`.
        redisClient.zrevrange(sortBy, start, start + 9, function (err, postIds) {
            err ? fail() : Promise.all(postIds.map(hgetAllPromise)).then(success).catch(fail);
        });

    }

    function hgetAllPromise(postId) {

        return new Promise((resolve, reject) => {
            redisClient.hgetall(postId, (err, postInfo) => {
                err ? reject(`cannot read post ${postId} from redis`) : resolve(postInfo);
            });
        });

    }

    //start the server.
    app.listen(3000, () => console.log('app listening on port 3000!'));

}

//this class represents a post.
//data from instagram contains more than what I need, its structure isn't redis friendly either, it will be converted to instances of this class instead.
class Post {

    constructor(id, caption, date, likes, comments, imgSrc, videoURL, dimensions) {
        this.id = id;
        this.caption = caption;
        this.date = date;
        this.likes = likes;
        this.comments = comments;
        this.imgSrc = imgSrc;
        this.videoURL = videoURL ? videoURL : "n/a";
        this.width = dimensions.width;
        this.height = dimensions.height;
        this.isPinned = "false";
    }

}

function storePostInfoIntoRedis(postInfo) {

    let post = new Post(postInfo.code, postInfo.caption, postInfo.date, postInfo.likes.count, postInfo.comments.count, postInfo.display_src, postInfo.video_url, postInfo.dimensions);

    //store the complete post information in hash, with id being the key.
    redisClient.hmset(post.id, post);

    //sort the posts by various properties and store the results (ids of the post, and corresponding ranking) in skip list. skip list provides lg(n) search performance.
    redisClient.zadd("sortedByComments", post.comments, post.id);
    redisClient.zadd("sortedByDates", post.date, post.id);
    redisClient.zadd("sortedByLikes", post.likes, post.id);

}

var pinInc = 1000000000; //1 billion

function pinPost(post) {
    post.isPinned = "true";
    redisClient.hset(post.id, "isPinned", "true");
    redisClient.zadd("sortedByComments", post.comments + pinInc, post.id);
    redisClient.zadd("sortedByDates", post.date + pinInc, post.id);
    redisClient.zadd("sortedByLikes", post.likes + pinInc, post.id);
}

function unpinPost(post){
    if(post.isPinned === "true") {
        post.isPinned = "false";
        redisClient.hset(post.id, "isPinned", "false");
        redisClient.zadd("sortedByComments", post.comments, post.id);
        redisClient.zadd("sortedByDates", post.date, post.id);
        redisClient.zadd("sortedByLikes", post.likes, post.id);
    }
}

//pull data from instagram. see `crawler.js` for more information.
crawler.crawlInstgram(storePostInfoIntoRedis);
startServer();








