/***************************************
 * Github Pull Request to Hipchat
 *
 * This script notifies a specified Hipchat Room ID and assign a reviewer
 * to review a pull request from a list of provided names. Combining this
 * script with Jenkins Github Pull Request Builder, it is possible
 * to automatically build a new pull request then assign a new reviewer
 * , notify a Hipchat room if the build is successful.
 **************************************/

var requiredArgs = {
  '--hipchat_room_id': 'Hipchat room ID for posing notification messages',
  '--hipchat_auth_token': 'Hipchat authentication token for making RESTful requests',
  '--github_hipchat_name_list': 'A list of Github, Hipchat catenated by - separated by , list of usernames e.g. thaibui-thai,vikrim1-VictorKrimshteyn,mattmcclain-MattMcclain,kerrykimbrough-KerryKimbrough,EdwinWiseOne-EdwinWise',
  '--github_pull_request_link': 'The pull request URL in Github',
  '--github_commit_author': 'The name of the committer of this pull request in Github e.g. thaibui'
}
var http = require('http');
var https = require('https');
var util = require('util');
var url = require('url')

var args = validate()

// Split the name list into a map of github usernames -> hipchat usernames
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

// Make sure the table is already created.
put("https://emodb-cert.qa.us-east-1.nexus.bazaarvoice.com/sor/1/_table/github:brandbattle:pullrequests?options=placement:'ugc_global:ugc'&audit=comment:'initial+provisioning',host:aws-tools-02", "{}", function(){
  // Check to see if the PR ${ghprbPullId} already has a reviewer
  var pullRequestId = args['--github_pull_request_link'].split('/').splice(-1).pop()
  get("https://emodb-cert.qa.us-east-1.nexus.bazaarvoice.com/sor/1/github:brandbattle:pullrequests/"+ pullRequestId, function(body){
    var pullRequest = JSON.parse(body)
    if(pullRequest['assigned']){
      console.log("Already assigned a reviewer for pull request ID " + pullRequestId + ". Exiting.")
    } else {
      console.log("Assigning a new pull request reviewer for pull request ID " + pullRequestId)
      assignReviewer(githubToHipchatName, args['--github_commit_author'], args['--github_pull_request_link'], args['--hipchat_room_id'], args['--hipchat_auth_token'], 2)
      put("https://emodb-cert.qa.us-east-1.nexus.bazaarvoice.com/sor/1/github:brandbattle:pullrequests/{id}?audit=comment:'initial+provisioning',host:aws-tools-02".replace('{id}', pullRequestId), '{"assigned": true}', function(){
        console.log("Successfully assigned reviewer for pull request ID " + pullRequestId)
      })
    }
  })
})

/***********************************
 * UTILITIES
 **********************************/

/**
 * Validate the command line arguments. Returned the parsed arguments if the validation passes
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

  return args
}

/**
 * Print a help message
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
 * Post a message to the provided Hipchat room ID
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

  var options = {
    host: "https://api.hipchat.com",
    port: 80,
    path: "/v2/room/" + roomId + "/notification?auth_token=" + authToken,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': body.length
    }
  }

  invoke(http, options, body, successCallback)
}

/**
 * Perform a HTTP GET, collecting the body and call the responseCallback(body) when
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
 * Perform a HTTP PUT, collecting the body and call the responseCallback(body) when
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
 * Invoke a HTTP request, write the data to the request, handle callback
 * @param http The http client object, could be http or https
 * @param options
 * @param data
 * @param responseCallback
 */
function invoke(http, options, data, responseCallback){
  var request = http.request(options, function(res){
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
 * Randomly pick and assign maxReviewers from the map nameList (where it maps Github username to Hipchat username) as reviewers
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
    var msg = "A new pull request is created at " + pullRequestURL + "\n@" + outputHipchatNames[primary] + " could you please review this request?"
    msg += secondary != undefined ? " If not, @" + outputHipchatNames[secondary] +" could you do that? Thanks!" : " Thanks!"

    post(msg, roomId, authToken, function() {
      console.info("Message sucessfully posted to Hipchat room_id " + roomId)
    })
  } else {
    console.warn("No possible reviewer exists. The list of Github authors is " + Object.keys(githubToHipchatName)
      + " but pull-request-to-hipchat needs a list of two or more authors including the commit's author " + commitAuthor)
  }
}
