/**
 * Author: Jeremy Pollock
 * https://github.com/jpollock
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 * 
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 * 
 * You should have received a copy of the MIT License
 * along with this program.  .
 * 
 *
 * @description: Allows user to store their Tidepool data in their own
 * Nightscout server by facilitating the transfer of latest records
 * from Tidepool's server into theirs.
 */
var request = require('request');
var qs = require('querystring');
var crypto = require('crypto');
var moment = require('moment-timezone');

// Defaults
var server = "api.tidepool.org"
var bridge = readENV('TIDEPOOL_SERVER')
    if (bridge && bridge.indexOf(".") > 1) {
    server = bridge;
   } 
    else if (bridge && bridge === 'EU') {
        server = "api.tidepool.org";
    } else {
        server = "api.tidepool.org";
    }

var Defaults = {
  "applicationId":"d89443d2-327c-4a6f-89e5-496bbb0317db"
, "lastGuid":"1e0c094e-1e54-4a4f-8e6a-f94484b53789" // hardcoded, random guid; no Tidepool docs to explain need for param or why bad data works
, login: 'https://' + server + '/api/v2/users/sign_in'
, accept: 'application/json'
, 'content-type': 'application/json'
, TidePoolDataUri: 'https://' + server + '/data/'
// ?sessionID=e59c836f-5aeb-4b95-afa2-39cf2769fede&minutes=1440&maxCount=1"
, nightscout_upload: '/api/v1/treatments.json'
, nightscout_upload_profile: '/api/v1/profile.json'
, MIN_PASSPHRASE_LENGTH: 12
};



// assemble the POST body for the login endpoint
function login_payload (opts) {
  var body = {
    "userLogin": {
      "email": opts.accountName,
      "password": opts.password
    },
    "deviceInformation": {
      "deviceModel": "iPhone"
    }    
  };
  return body;
}

// Login to Tidepool's server.
function authorize (opts, then) {
  var url = 'https://'+ config.accountName +':' + config.password + '@' + server + '/auth/login';
  var body = login_payload(opts);
  var headers = { 'User-Agent': Defaults.agent
                , 'Content-Type': Defaults['content-type']
                , 'Accept': Defaults.accept };
  var req ={ uri: url, body: body, json: true, headers: headers, method: 'POST'
           , rejectUnauthorized: false };
  // Asynchronously calls the `then` function when the request's I/O
  // is done.
  return request(req, then);
}

// Assemble query string for fetching data.
function fetch_query (url, opts) {
  // ?sessionID=e59c836f-5aeb-4b95-afa2-39cf2769fede&minutes=1440&maxCount=1"
  var q = {
    //lastUpdatedAt: opts.lastUpdatedAt
  //, 
    lastGuid: Defaults.lastGuid
  , sendSoftDeleted: opts.sendSoftDeleted || false
  , limit: opts.maxCount || 1000
  };
  //url += '&lastUpdatedAt=' + opts.lastUpdatedAt  + '&' + qs.stringify(q);
  url += '&startDate=2018-12-01T00:00:00.000Z'
  //url += '&startDate=2018-12-28T00:00:00.000Z'
  console.log(url);
  return url;
}

// Asynchronously fetch data from Dexcom's server.
// Will fetch `minutes` and `maxCount` records.
function fetch (url, opts, then) {

  var url = fetch_query(url, opts);
  var headers = { 'User-Agent': Defaults.agent
                , 'Content-Type': Defaults['content-type']
                , 'Content-Length': 0
                , 'Accept': Defaults.accept
                , 'x-tidepool-session-token': opts.sessionID };

  var req ={ uri: url, json: true, headers: headers, method: 'GET'
           , rejectUnauthorized: false };
  return request(req, then);
}

// Authenticate and fetch data from Dexcom.
function do_everything (opts, then) {
  var login_opts = opts.login;
  var fetch_opts = opts.fetch;
  authorize(login_opts, function (err, res, body) {
    var arr = {};
    fetch_opts.sessionID = res.headers['x-tidepool-session-token'];
    fetch_opts.userID = res.body.userid;
    var d_now = Date.now();
    var d_then = new Date(d_now - 600*60000)
    //console.log(d_then);
    //var fetch_opts = Object.create(opts.fetch);
    fetch_opts.lastUpdatedAt = d_then.toISOString();

    fetch(Defaults.TidePoolDataUri + fetch_opts.userID + '?type=wizard', fetch_opts, function (err, res, foods) {
      fetch(Defaults.TidePoolDataUri + fetch_opts.userID+ '?type=bolus', fetch_opts, function (err, res, boluses) {
        fetch(Defaults.TidePoolDataUri + fetch_opts.userID+ '?type=basal', fetch_opts, function (err, res, basals) {
          fetch(Defaults.TidePoolDataUri + fetch_opts.userID+ '?type=pumpSettings', fetch_opts, function (err, res, profiles) {
            arr['foods'] = foods;
            arr['boluses'] = boluses;
            arr['basals'] = basals;
            arr['profiles'] = profiles;
            console.log("Foods: " + foods.length + " Boluses:" + boluses.length  + " Basals:" + basals.length + " Profiles:" + profiles.length);
            then(err, arr);
          });    
        });    
      });
    });
  });

}

function generate_nightscout_treatments(entries, then) {
      // Snack Bolus
      // Meal Bolus
      // BG Check
      // Correction Bolus
      // Carb Correction  
      //console.log(entries['foods']);
  var foods = entries['foods']; //ugh
  var insulins = entries['boluses'];
  var basals = entries['basals'];
  
  var treatments = []
  
  if (foods) {
    foods.forEach(function(element) {
      var treatment = {};

      //console.log(element);
      var f_date = new Date(element.timestamp);
      var f_s_date = new Date(f_date.getTime() - 45*60000);
      var f_e_date = new Date(f_date.getTime() + 45*60000);

      var now = moment(f_date); //todays date
      var end = moment(f_s_date); // another date
      var duration = moment.duration(now.diff(end));
      var minutes = duration.asMinutes();

      var i_date = new Date();
      var result = insulins.filter(function(el) {
          i_date = new Date(el.timestamp);
          var i_moment = moment(i_date);
          var duration = moment.duration(now.diff(i_moment));
          var minutes = duration.asMinutes();
          return Math.abs(minutes) < 46;

      })
      

      insulin = result[0];
      if (insulin != undefined) {
        var i_date = moment(insulin.timestamp);
        treatment.eventType = 'Meal Bolus';
        //treatment.eventTime = new Date(i_date + 420*60000).toISOString( );
        treatment.eventTime = element.time;// new Date(f_date + 420*60000).toISOString( );
        //treatment.eventTime = new Date(i_date).toISOString( );
        //treatment.eventTime = i_date.toISOString( );
        treatment.insulin = insulin.normal;
        if (insulin.extended) {
          treatment.insulin += insulin.extended
        }
        

        treatment.preBolus = moment.duration(moment(f_date).diff(moment(i_date))).asMinutes();
      } else {
        var f_date = moment(element.timestamp);
        treatment.eventType = 'Carb Correction';
        //treatment.eventTime = new Date(f_date + 420*60000).toISOString( );
        treatment.eventTime = element.time;// new Date(f_date + 420*60000).toISOString( );
        //treatment.eventTime = new Date(f_date).toISOString( );
        //treatment.eventTime = f_date.toISOString( );
      }

      treatment.carbs = element.carbInput;
      //treatment.notes = JSON.stringify(element);
      
      treatments.push(treatment);


    });    
  }

  if (insulins) {
    insulins.forEach(function(element) {
      var treatment = {};

      //console.log(element);
      var f_date = new Date(element.timestamp);
      var f_s_date = new Date(f_date.getTime() - 45*60000);
      var f_e_date = new Date(f_date.getTime() + 45*60000);

      var now = moment(f_date); //todays date
      var end = moment(f_s_date); // another date
      var duration = moment.duration(now.diff(end));
      var minutes = duration.asMinutes();

      var i_date = new Date();
      var result = foods.filter(function(el) {
          i_date = new Date(el.timestamp);
          var i_moment = moment(i_date);
          var duration = moment.duration(now.diff(i_moment));
          var minutes = duration.asMinutes();
          return Math.abs(minutes) < 46;

      })
      //console.log(element);
      //if (result[0] == undefined) {
        var f_date = moment(element.time);
        treatment.eventType = 'Correction Bolus';
        treatment.eventTime = element.time;// new Date(f_date + 420*60000).toISOString( );
        treatment.insulin = element.normal;
        if (element.extended) {
          treatment.insulin += element.extended
        }
        

        //treatment.eventTime = f_date.toISOString( );
        treatments.push(treatment);
      //}
    });    
  }

  if (basals) {
    basals.forEach(function(element) {
      var treatment = {};

      //console.log(element);
      /*
      var f_date = new Date(element.timestamp);
      var f_s_date = new Date(f_date.getTime() - 45*60000);
      var f_e_date = new Date(f_date.getTime() + 45*60000);

      var now = moment(f_date); //todays date
      var end = moment(f_s_date); // another date
      var duration = moment.duration(now.diff(end));
      var minutes = duration.asMinutes();

      var i_date = new Date();
      var result = foods.filter(function(el) {
          i_date = new Date(el.timestamp);
          var i_moment = moment(i_date);
          var duration = moment.duration(now.diff(i_moment));
          var minutes = duration.asMinutes();
          return Math.abs(minutes) < 46;

      })
      */
      //console.log(element.deliveryType);
      if (element.deliveryType == 'temp') {
        var f_date = moment(element.time);
        treatment.eventType = 'Temp Basal';
        treatment.eventTime = element.time;// new Date(f_date + 420*60000).toISOString( );
        treatment.absolute = element.rate;
        treatment.duration = element.duration / 60000;
        

        //treatment.eventTime = f_date.toISOString( );
        treatments.push(treatment);
      }
    });    
  }

  then(err, treatments);
}


function generate_nightscout_profiles(entries, then) {
  var t_profiles = entries['profiles'];

  t_profiles.forEach(function(profile) {
    //console.log(profile);
  });

  var profiles = []
  


  if (t_profiles) {
    var element = t_profiles[0];
    console.log(element);
    var profile = {};
    profile._id = "5ad2860e95ab570013dc1048";
    profile.defaultProfile = "Default";
    profile.store = {}
      
    profiles.push(profile);
  }


  [{"_id":"5ad2860e95ab570013dc1048","defaultProfile":"Default","store":{"Default":{"dia":"5","carbratio":[{"time":"00:00","value":"10","timeAsSeconds":"0"},{"time":"09:00","value":"14","timeAsSeconds":"32400"},{"time":"17:00","value":"15","timeAsSeconds":"61200"}],"carbs_hr":"20","delay":"20","sens":[{"time":"00:00","value":"250","timeAsSeconds":"0"},{"time":"09:00","value":"200","timeAsSeconds":"32400"},{"time":"20:00","value":"180","timeAsSeconds":"72000"},{"time":"23:00","value":"220","timeAsSeconds":"82800"}],"timezone":"US/Pacific","basal":[{"time":"00:00","value":"0.05","timeAsSeconds":"0"},{"time":"01:30","value":"0.1","timeAsSeconds":"5400"},{"time":"05:30","value":"0.05","timeAsSeconds":"19800"},{"time":"07:00","value":"0.15","timeAsSeconds":"25200"},{"time":"09:00","value":"0.05","timeAsSeconds":"32400"},{"time":"12:00","value":"0.2","timeAsSeconds":"43200"},{"time":"13:00","value":"0.1","timeAsSeconds":"46800"},{"time":"16:00","value":"0.15","timeAsSeconds":"57600"},{"time":"20:00","value":"0.45","timeAsSeconds":"72000"},{"time":"22:00","value":"0.1","timeAsSeconds":"79200"}],"target_low":[{"time":"00:00","value":"80","timeAsSeconds":"0"}],"target_high":[{"time":"00:00","value":"140","timeAsSeconds":"0"}],"startDate":"1970-01-01T00:00:00.000Z","units":"mg/dl"}},"startDate":"1970-01-01T00:00:00.000Z","mills":"0","units":"mg/dl","created_at":"2018-04-14T22:51:58.013Z"},{"_id":"5bf6c62e372d6f0012416a60","created_at":"2018-11-22T15:07:26.220Z"},{"_id":"5bf6c627372d6f0012416a5f","created_at":"2018-11-22T15:07:19.072Z"}]

  then(err, profiles);
}

// Record data into Nightscout.
function report_to_nightscout (opts, then) {
  var shasum = crypto.createHash('sha1');
  var hash = shasum.update(opts.API_SECRET);
  //console.log(shasum.digest('hex'));
  var headers = { 'api-secret': shasum.digest('hex')
                , 'Content-Type': Defaults['content-type']
                , 'Accept': Defaults.accept };
  var url = opts.endpoint + Defaults.nightscout_upload;
  console.log(url);
  var req = { uri: url, body: opts.treatments, json: true, headers: headers, method: 'POST'
            , rejectUnauthorized: false };
  return request(req, then);

}


function engine (opts) {

  var runs = 0;
  var failures = 0;
  function my ( ) {
    console.log('RUNNING', runs, 'failures', failures);
    if (my.sessionID) {
      var fetch_opts = Object.create(opts.fetch);
      if (runs === 0) {
        console.log('First run, fetching', opts.firstFetchCount);
        fetch_opts.maxCount = opts.firstFetchCount;
      }
      fetch_opts.sessionID = my.sessionID;
      
      var now = Date.now();
      var then = new Date(now - 600*60000)
      console.log(then);
      //var fetch_opts = Object.create(opts.fetch);
      fetch_opts.lastUpdatedAt = then.toISOString();

      var arr = {};
      fetch(Defaults.TidePoolDataUri + fetch_opts.userID + '?type=wizard', fetch_opts, function (err, res, foods) {
        fetch(Defaults.TidePoolDataUri + fetch_opts.userID + '?type=bolus', fetch_opts, function (err, res, boluses) {
          fetch(Defaults.TidePoolDataUri + fetch_opts.userID + '?type=basal', fetch_opts, function (err, res, basals) {
            fetch(Defaults.TidePoolDataUri + fetch_opts.userID + '?type=pumpSettings', fetch_opts, function (err, res, profiles) {
              arr['foods'] = foods;
              arr['boluses'] = boluses;
              arr['basals'] = basals;
              arr['profiles'] = profiles;
              to_nightscout(arr);
            });
          });
        });
      });
    } else {
      failures++;
      refresh_token( );
    }
  }

  function refresh_token ( ) {
    console.log('Fetching new token');
    authorize(opts.login, function (err, res, body) {
      if (!err && body && res.statusCode == 200) {
        my.sessionID = res.headers['set-cookie'][0];
        failures = 0;
        my( );
      } else {
        failures++;
        console.log("Error refreshing token", err, res.statusCode, body);
        if (failures >= opts.maxFailures) {
          throw "Too many login failures, check TIDEPOOL_ACCOUNT_NAME and TIDEPOOL_PASSWORD";
        }
      }
    });
  }

  function to_nightscout (entries) {
    var ns_config = Object.create(opts.nightscout);
    if (entries) {
      generate_nightscout_treatments(entries, function(err, treatments) {
        //var entries = glucose.map(dex_to_entry);
        console.log('TREATMENTS='+treatments);
        //console.log(opts.callback);
        if (opts && opts.callback && opts.callback.call) {
          opts.callback(null, treatments);
        }
        
        if (ns_config.endpoint) {
          ns_config.treatments = treatments;
          // Send data to Nightscout.
         report_to_nightscout(ns_config, function (err, response, body) {
            console.log("Nightscout Tidepool upload", 'error', err, 'status', response.statusCode, body);

          });
        }
      });          
    }
  }

  my( );
  return my;
}

// Provide public, testable API
engine.fetch = fetch;
engine.authorize = authorize;
engine.authorize_fetch = do_everything;
module.exports = engine;

function readENV(varName, defaultValue) {
    //for some reason Azure uses this prefix, maybe there is a good reason
    var value = process.env['CUSTOMCONNSTR_' + varName]
        || process.env['CUSTOMCONNSTR_' + varName.toLowerCase()]
        || process.env[varName]
        || process.env[varName.toLowerCase()];

    return value || defaultValue;
}

// If run from commandline, run the whole program.
if (!module.parent) {
  if (readENV('API_SECRET').length < Defaults.MIN_PASSPHRASE_LENGTH) {
    var msg = [ "API_SECRET environment variable should be at least"
              , Defaults.MIN_PASSPHRASE_LENGTH, "characters" ];
    var err = new Error(msg.join(' '));
    throw err;
    process.exit(1);
  }
  var args = process.argv.slice(2);
  var config = {
    accountName: readENV('TIDEPOOL_ACCOUNT_NAME')
  , password: readENV('TIDEPOOL_PASSWORD')
  };
  var ns_config = {
    API_SECRET: readENV('API_SECRET')
  , endpoint: readENV('NS', 'http://' + readENV('WEBSITE_HOSTNAME'))
  };
  var interval = readENV('SHARE_INTERVAL', 60000 * 2.5);
  var fetch_config = { maxCount: readENV('maxCount', 1)
    , minutes: readENV('minutes', 1440)
  };
  var meta = {
    login: config
  , fetch: fetch_config
  , nightscout: ns_config
  , maxFailures: readENV('maxFailures', 3)
  , firstFetchCount: readENV('firstFetchCount', 3)
  };
  switch (args[0]) {
    case 'login':
      //authorize(config, console.log.bind(console, 'login'));
      authorize(config, function (err, res, body) {
        if (!err && body && res.statusCode == 200) {
          console.log(res.headers['x-tidepool-session-token']);
          console.log(res.body.userid);
          //console.log("Success refreshing token", err, res.statusCode, body);
        } else {
          console.log("Error refreshing token", err, res.statusCode, body);
        }
      });

      /*authorize(config, function (err, res) {
        console.log(err);
      });*/
      break;
    case 'fetch':
      config = { sessionID: args[1] };
      fetch(config, console.log.bind(console, 'fetched'));
      break;
    case 'testdaemon':
      setInterval(engine(meta), 2500);
      break;
    case 'run':
      // Authorize and fetch from Tidepool
      var now = Date.now();
      var then = new Date(now - 19200*60000)
      //var fetch_opts = Object.create(opts.fetch);
      meta.fetch.lastUpdatedAt = then.toISOString();
      
      do_everything(meta, function (err, entries) {
        //console.log('Entries', entries['foods']);
        if (entries) {
          // Translate to Nightscout data.
          generate_nightscout_treatments(entries, function(err, treatments) {
            //var entries = glucose.map(dex_to_entry);
            //console.log(ns_config);
            if (ns_config.endpoint) {
              ns_config.treatments = treatments;
              //console.log(treatments);
              // Send data to Nightscout.
              report_to_nightscout(ns_config, function (err, response, body) {
                console.log("Nightscout upload", 'error', err, 'status', response.statusCode, body);

              });
              
            }
          });
          generate_nightscout_profiles(entries, function(err, profiles) {
            //var entries = glucose.map(dex_to_entry);
            if (ns_config.endpoint) {
              ns_config.profiles = profiles;
              console.log(profiles);
              // Send data to Nightscout.
              /*report_to_nightscout(ns_config, function (err, response, body) {
                console.log("Nightscout upload", 'error', err, 'status', response.statusCode, body);

              });*/
            }
          });

        }
      });
      break;
    default:
      setInterval(engine(meta), interval);
      break;
      break;
  }
}
