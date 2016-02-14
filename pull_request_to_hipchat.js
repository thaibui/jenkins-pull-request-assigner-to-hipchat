/***************************************
 * Github Pull Request to Hipchat
 *
 * This script notifies a specified Hipchat Room ID and assigns a reviewer
 * to review a pull request from a list of provided names. Combining this
 * script with Jenkins Github Pull Request Builder, it is possible
 * to automatically build a new pull request then assign a new reviewer,
 * notify a Hipchat room if the build is successful.
 **************************************/

var requiredArgs = {
  '--hipchat_room_id': 'Hipchat room ID for posing notification messages',
  '--hipchat_auth_token': 'Hipchat authentication token for making RESTful requests',
  '--github_hipchat_name_list': 'A list of Github, Hipchat catenated by - separated by , list of usernames e.g. thaibui-thai,vikrim1-VictorKrimshteyn,mattmcclain-MattMcclain,kerrykimbrough-KerryKimbrough,EdwinWiseOne-EdwinWise',
  '--github_pull_request_link': 'The pull request URL in Github',
  '--github_commit_author': 'The name of the committer of this pull request in Github e.g. thaibui'
}
var https = require('https');
var util = require('util');
var url = require('url')

var args = validate()

// Splits the name list into a map of github usernames -> hipchat usernames
var githubToHipchatName = {}
args['--github_hipchat_name_list'].split(',').forEach(function(githubHipchatName){
  var tuple = githubHipchatName.split('-') || []
  if (tuple.length != 2){
    console.error("Incorrect Githip-Hipchat name list " + githubHipchatName  + ". Use --help for an example of correct name list.");
    process.exit(-1)
  }
  var githubUsername = tuple[0]
  var hipchatUsername = tuple[1]
  githubToHipchatName[githubUsername] = hipchatUsername
})

// Makes sure the table is already created.
put(args['createUrl'], "{}", function(){
  // Check to see if the PR ${ghprbPullId} already has a reviewer
  var pullRequestId = args['--github_pull_request_link'].split('/').splice(-1).pop()
  get(args['checkUrl'].replace('{id}',pullRequestId), function(body){
    var pullRequest = JSON.parse(body)
    if(pullRequest['assigned']){
      console.log("Already assigned a reviewer for pull request ID " + pullRequestId + ". Exiting.")
    } else {
      console.log("Assigning a new pull request reviewer for pull request ID " + pullRequestId)
      assignReviewer(githubToHipchatName, args['--github_commit_author'], args['--github_pull_request_link'], args['--hipchat_room_id'], args['--hipchat_auth_token'], 2)
      put(args['updateUrl'].replace('{id}', pullRequestId), '{"assigned": true}', function(){
        console.log("Successfully assigned reviewer for pull request ID " + pullRequestId)
      })
    }
  })
})

/***********************************
 * UTILITIES
 **********************************/

/**
 * Validates the command line arguments. Returned the parsed arguments if the validation passes
 */
function validate(){
  var argsCLI = process.argv.splice(2) || []

  var args = {};
  for(var i = 0; i < argsCLI.length; i++){
    var key = argsCLI[i];

    if(key == '--help'){
      printHelp()
      process.exit(-1)
    }

    if(requiredArgs.hasOwnProperty(key)){
      var value = argsCLI[++i] || ''
      if (value.trim().length == 0){
        console.error("Value for argument " + key + " cannot be empty")
        process.exit(-1)
      }

      args[key] = value
    } else {
      console.error("Unknown argument " + key + ". For a list of arguments and its usage, use --help");
      process.exit(-1)
    }
  }

  // Missing arguments
  if(Object.keys(args).length < Object.keys(requiredArgs).length){
    console.error("Missing arguments " + Object.keys(requiredArgs).filter(function(e){
      return Object.keys(args).indexOf(e) < 0
    }) + ". See --help for more information.")
    process.exit(-1)
  }

  // Missing environment variables?
  createUrl = process.env.PULL_REQUEST_CREATE_TABLE_URL || ''; // The url of the HTTP service to create a table for storing related information using PUT',
  checkUrl = process.env.PULL_REQUEST_CHECK_URL || '';         // The url of the HTTP service to retrieve a record in a requested table using GET',
  updateUrl = process.env.PULL_REQUEST_UPDATE_URL || '';       // The url of the HTTP service to update a record in a requested table using PUT'

  if(createUrl == '') {
    console.error("Missing environment variable PULL_REQUEST_CREATE_TABLE_URL")
    process.exit(-1)
  }

  if(updateUrl == '') {
    console.error("Missing environment variable PULL_REQUEST_UPDATE_URL")
    process.exit(-1)
  }

  if(checkUrl == '') {
    console.error("Missing environment variable PULL_REQUEST_CHECK_URL")
    process.exit(-1)
  }

  args['createUrl'] = createUrl
  args['updateUrl'] = updateUrl
  args['checkUrl'] = checkUrl

  return args
}

/**
 * Prints a help message
 */
function printHelp(){
  var message = "This script requires " + Object.keys(requiredArgs).length + " arguments with their associated values. " +
    "The arguments and their values are: \n\n";

  Object.keys(requiredArgs).forEach(function(key){
    message += key + ": " + requiredArgs[key] + "\n";
  });

  message += "\nFor example, \n\n" + "node pull_request_to_hipchat.js ";
  Object.keys(requiredArgs).forEach(function(key){
    message += key + " <VALUE> ";
  });

  console.log(message);
}

/**
 * Posts a message to the provided Hipchat room ID
 * @param msg
 * @param roomId
 * @param authToken
 * @param successCallback
 */
function post(msg, roomId, authToken, successCallback){

  var body = JSON.stringify({
    'color': 'purple',
    'message_format': 'text',
    'message': msg
  });

  var options = util._extend({
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': body.length
    }
  }, url.parse("https://api.hipchat.com" + "/v2/room/" + roomId + "/notification?auth_token=" + authToken))

  invoke(https, options, body, successCallback)
}

/**
 * Posts a message to the provided Hipchat room ID v1
 * @param msg
 * @param roomId
 * @param authToken
 * @param successCallback
 */
function postV1(msg, roomId, authToken, format, successCallback){
  serialize = function(obj) {
    var str = [];
    for(var p in obj)
      if (obj.hasOwnProperty(p)) {
        str.push(encodeURIComponent(p) + "=" + encodeURIComponent(obj[p]));
      }
    return str.join("&");
  }

  var body = serialize({
    'room_id': roomId,
    'color': 'purple',
    'from': 'PR Assigner',
    'message_format': format,
    'message': msg
  });

  var options = util._extend({
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': body.length
    }
  }, url.parse("https://api.hipchat.com" + "/v1/rooms/message?auth_token=" + authToken))

  invoke(https, options, body, successCallback)
}

/**
 * Performs a HTTP GET, collecting the body and call the responseCallback(body) when
 * the body has been collected and parsed to JSON
 * @param url
 * @param responseCallback
 */
function get(requestUrl, responseCallback){

  var options = util._extend({
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'Accept': '*/*'
    }
  }, url.parse(requestUrl))

  invoke(https, options, undefined, responseCallback);
}

/**
 * Performs a HTTP PUT, collecting the body and call the responseCallback(body) when
 * the body has been collected and parsed to JSON
 * @param url
 * @param responseCallback
 */
function put(requestUrl, data, responseCallback){

  var body = new Buffer(data)
  var options = util._extend({
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': body.length,
      'Accept': '*/*'
    }
  }, url.parse(requestUrl))

  invoke(https, options, body, responseCallback)
}

/**
 * Invokes a HTTP request, writes the data to the request, handles callback
 * @param client The http client object, could be http or https
 * @param options
 * @param data
 * @param responseCallback
 */
function invoke(client, options, data, responseCallback){
  console.log("[INFO] HTTP request: " + JSON.stringify(options))
  var request = client.request(options, function(res){
    var body = '';

    res.on('data', function(chunk){
      body += chunk
    })

    res.on('end', function(){
      responseCallback(body)
    })
  });

  request.on('error', function(e){
    console.error("Problem with request: " + e.message);
  })

  if(data != undefined) {
    request.write(data);
  }
  request.end();
}

/**
 * Randomly picks and assigsn maxReviewers from the map nameList (where it maps Github username to Hipchat username) as reviewers
 *
 * @param nameList
 * @param commitAuthor
 * @param pullRequestURL
 * @param roomId
 * @param authToken
 * @param maxReviewers
 */
function assignReviewer(nameList, commitAuthor, pullRequestURL, roomId, authToken, maxReviewers){
  var outputHipchatNames = {}
  var numReviewer = 0

  // Remove the commit author out of the potential list of reviewing authors
  githubNames = Object.keys(nameList)
  githubNames.splice(githubNames.indexOf(commitAuthor), 1)

  // Randomly choose numOutputReviewer
  while(numReviewer < maxReviewers && numReviewer < githubNames.length){
    // get a random name from the list of Github names
    var index = Math.floor(Math.random() * githubNames.length)
    var githubUsername = githubNames[index]

    // If the commit author is not chosen
    if(!outputHipchatNames.hasOwnProperty(githubUsername)) {
      outputHipchatNames[githubUsername] = githubToHipchatName[githubUsername]
      numReviewer++
    }
  }

  // Decide if reviewers exits, if they do, post the message to the provided Hipchat room ID
  var names = Object.keys(outputHipchatNames)
  var primary = names.length > 0 ? names[0] : undefined
  var secondary = names.length > 1 ? names[names.length - 1] : undefined

  if (primary != undefined) {
    var firstMsg = 'A new pull request is created at <a href="' + pullRequestURL + '">' + pullRequestURL + '</a>';
    var secondMsg = "@" + outputHipchatNames[primary] + ", could you please review this request?";
    secondMsg += secondary != undefined ? " If not, @" + outputHipchatNames[secondary] +", could you do that? Thanks!" : " Thanks!"

    postV1(firstMsg, roomId, authToken, 'html', function() {
      postV1(secondMsg, roomId, authToken, 'text', function() {
          console.info("Message sucessfully posted to Hipchat room_id " + roomId)
      })
    })
  } else {
    console.warn("No possible reviewer exists. The list of Github authors is " + Object.keys(githubToHipchatName)
      + " but pull-request-to-hipchat needs a list of two or more authors including the commit's author " + commitAuthor)
  }
}
