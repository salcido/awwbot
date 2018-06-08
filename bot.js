// =======================================================
//  Overview
//  -----------------------------------------------------
//  Awwbot mirrors top image-based posts from various
//  animal subreddits and tweets them.
//  -----------------------------------------------------
//  @author: Matthew Salcido
//  @github: https://www.github.com/salcido
//  @source: https://github.com/salcido/awwbot
//  @bot-url: https://www.twitter.com/awwtomatic
// =======================================================

// TODO: add DB to store image hashes to check for reposts

// ========================================================
// Module Dependencies
// ========================================================
require('dotenv').config();
const fetch = require('node-fetch');
const sharp = require('sharp');
const Twit = require('twit');

// ========================================================
// Assets / Utilities
// ========================================================
const { colors } = require('./assets/colors');
const { logo } = require('./assets/logo');
const { utils: { alphabetize,
                 generateImgurUrl,
                 generateShortLinks,
                 isTextSub,
                 meta,
                 minutes,
                 sanitizeTitle,
                 timestamp
                }} = require('./assets/utils');
// ========================================================
// Auth values
// ========================================================
const secret = {
  consumer_key: process.env.CONSUMER_KEY,
  consumer_secret: process.env.CONSUMER_SECRET,
  access_token: process.env.ACCESS_TOKEN,
  access_token_secret: process.env.ACCESS_TOKEN_SECRET
};

// ========================================================
// Global vars
// ========================================================
const Twitter = new Twit(secret);
// Number of minutes between posts and updates;
const interval = minutes(35);
// Number of posts to return from each subreddit
const limit = 100;
// Bot's twitter handle for timeline data
const screenName = 'awwtomatic';
// Subs to pull posts from
const subs = [
              'aww',
              'awwducational',
              'rarepuppers',
              'eyebleach',
              'animalsbeingderps',
              'superbowl',
              'ilikthebred',
              'whatswrongwithyourdog',
              'Showerthoughts'
            ];
// Subs that are 'text-only'
const textSubs = ['Showerthoughts', 'nocontext'];
// Minimum number of upvotes a post should have
const threshold = 1100;
// Timezone offset (for logging fetches and tweets)
const utcOffset = -7;

// ========================================================
// Post queue and twitter timeline arrays
// ========================================================
let queue = [];
let timeline = [];

// ========================================================
// Functions (alphabetical)
// ========================================================

/**
 * Converts raw buffer data to base64 string
 * @param {string} buffer Raw image data
 * @returns {string}
 */
function base64Encode(buffer) {

  if ( buffer.byteLength > 5000000 )  {
    return resize(Buffer.from(buffer, 'base64'));
  }

  return new Buffer(buffer).toString('base64');
}

/**
 * Gets the next post in the queue
 * @returns {method}
 */
function getNextPost() {

  if ( queue.length ) {

    let post = queue.shift(),
        title = post.data.title;

    console.log(' ');
    console.log(colors.reset, 'Attempting to post...');
    console.log(title);
    console.log('queue length: ', queue.length);

    if ( !timeline.some(t => t.text.includes(title.substring(0, 100))) ) {
      // Reset the queue after tweeting so that we're only tweeting
      // the most upvoted, untweeted post every interval
      queue = [];
      return tweet(post);
    }
    console.log('Seen it. NEXT!!!');
    return getNextPost();
  }
  return;
}

/**
 * Gets the top posts from a subreddit
 * and removes any posts that are gifs or videos.
 * Also updates imgur links to point directly to
 * the image on imgur.com
 * @returns {method}
 */
function getPosts() {

  let url = `https://www.reddit.com/r/${subs.join('+')}/top.json?limit=${limit}`;

  // List subs in query
  console.log(colors.yellow, 'Gathering new posts...');

  return fetch(url, {cache: 'no-cache'})
  .then(res => res.json())
  .then(json => {

    let images,
        imgur,
        jpgs,
        pngs,
        posts = json.data.children,
        texts;

    // Replace any necessary characters in the title
    posts.forEach(p => p.data.title = sanitizeTitle(p.data.title));

    texts = posts.filter(p => !p.data.is_video
                           && p.data.title.length <= 280
                           && isTextSub(p, textSubs));
    // Decorate posts with meta prop
    texts = meta(texts, 'text');

    // Ignore videos and .gif* files;
    // make sure the upvotes meet the threshold
    images = posts.filter(p => !p.data.is_video
                            && !p.data.url.includes('.gif')
                            && p.data.ups >= threshold
                            && p.data.title.length <= 280);
    // Decorate posts with meta prop
    images = meta(images, 'image');

    // Gather up the image-based posts
    pngs = images.filter(p => p.data.url && p.data.url.includes('.png'));
    jpgs = images.filter(p => p.data.url.includes('.jpg'));
    imgur = images.filter(p => p.data.url.includes('imgur.com')
                            && !p.data.url.includes('.jpg'));
    imgur = generateImgurUrl(imgur);

    // Update the queue with new posts
    queue.push(...pngs, ...jpgs, ...imgur, ...texts);

    return queue;
  })
  .catch(err => console.log(colors.red, 'Error getPosts() ', err));
}

/**
 * Gathers post data, mutates it, then
 * gets twitter timeline data
 * @returns {promise}
 */
function getPostsAndTimeline() {
  // Show logo on startup
  printLogo();
  // Grab our data
  return new Promise((resolve, reject) => {
    getPosts()
    .then(posts => {
      // Process our post data
      queue = generateShortLinks(posts);
      queue = queue.sort(alphabetize).reverse();
    })
    .then(() => getTimeline())
    .then(() => resolve())
    .catch(err => console.log(colors.red, 'Error getPostsAndTimeline() ', err));
  });
}

/**
 * Returns the 200 most recent tweets from the bot account
 * @returns {array.<object>}
 */
function getTimeline() {
  return new Promise((resolve, reject) => {
    let params = { screen_name: screenName, count: 200 };
    return Twitter.get('statuses/user_timeline', params, (err, data, res) => {
      timeline = data;
      return resolve();
    });
  });
}

/**
 * Logs the `awwbot` logo in the output
 * @returns {undefined}
 */
function printLogo() {
  console.log(colors.cyan, `${logo}`);
  console.log(colors.cyan, 'Next post: ', timestamp(utcOffset, interval));
}

/**
 * Resizes an image to 1000px wide so that
 * it will be under the 5mb limit Twitter requires
 * @param {string} buffer Raw image data
 * @returns {string}
 */
function resize(buffer) {
  return sharp(buffer).resize(1000).toBuffer()
         .then(data => new Buffer(data).toString('base64'))
         .catch(err => console.log(colors.red, 'Error resize() ', err));
}

/**
 * Grabs the post from Reddit and tweets it
 * @param {object} post A single post from a subreddit
 * @returns {method}
 */
function tweet(post) {

  switch (post.data.meta) {
    case 'text':
      return tweetText(post);
    case 'image':
      return tweetImage(post);
  }
}

/**
 * Tweets an update to Twitter with an image
 * @param {object} post A post from a subreddit
 * @returns {undefined}
 */
function tweetImage(post) {

  fetch(post.data.url)
    .then(res => res.arrayBuffer())
    .then(base64Encode)
    .then(res => {

      let title = post.data.title;

      Twitter.post('media/upload', { media_data: res }, (err, data, res) => {

        let mediaIdStr = data.media_id_string,
            meta_params = {
              media_id: mediaIdStr,
              alt_text: { text: title }
            };

        Twitter.post('media/metadata/create', meta_params, (err, data, res) => {

          if ( !err ) {

            let params = {
              status: `${title} ${post.data.shorty} \n#${post.data.subreddit}`,
              media_ids: [mediaIdStr]
            };

            Twitter.post('statuses/update', params, (err, data, res) => {
              console.log(colors.green, 'Post successfully tweeted!');
              console.log(colors.green, timestamp(utcOffset));
              console.log(colors.cyan, 'Next post: ', timestamp(utcOffset, interval));
              console.log(' ');
              if ( data.errors ) console.log(colors.red, data);
            });

          } else {
            console.log(' ');
            console.log(colors.red, 'There was an error when attempting to post...');
            console.error(err);
            console.log(' ');
          }
        });
      });
    })
    .catch(err => console.log(colors.red, 'Error tweet() ', err));
}

/**
 * Tweets a text-only update to Twitter
 * @param {object} post A post from a subreddit
 * @returns {undefined}
 */
function tweetText(post) {

  let title = post.data.title,
      params = {
        status: `${title} ${post.data.shorty} \n#${post.data.subreddit}`
      };

  Twitter.post('statuses/update', params, (err, data, response) => {
    console.log(colors.green, 'Post successfully tweeted!');
    console.log(colors.green, timestamp(utcOffset));
    console.log(colors.cyan, 'Next post: ', timestamp(utcOffset, interval));
    console.log(' ');
    if ( err ) console.log(colors.red, err);
    if ( data.errors ) console.log(colors.red, data);
  });
}

// ========================================================
// Init
// ========================================================
// let's get something positive from the internet for once...
printLogo();
setInterval(() => getPostsAndTimeline().then(() => getNextPost()), interval);
