
var schedule = require('node-schedule')
  , cronParser = require('cron-parser')
  , tvPlayer = require('./lib/tv-player')
  , fs = require('fs')
  , pathspec = require('pathspec')
  , glob = require('glob')
  , guideGen = require('./lib/guide-gen')
  , theSchedule = {}
  , _ = require('lodash')
  , express = require('express')
  , serveStatic = require('serve-static')
  , scheduleValidator = require('./lib/schedule-validator')
  , colors = require('colors');


module.exports=function(options){


  /*
    schedule.json format:
    
    {
      "jobs":[
        {
          "name":"short films",
          "cron":"0 20 * * *",
          "pathspec":"~/videos/shortfilms/*.mp4"
        }
      ],
      "commercials":[
        {
          "name":"1990s commercials",
          "pathspec":"~/videos/commercials/1990s/*.mp4" 
        }
      ]
      "options":{
    
      }
    }
  */

  /*
    call this program with schedule.json filename

    OR just modify the schedule.json default file

  */

  
  //globals
  var schedule;
  var guide = [];
  var guideNext = {};

  if(options.file){    
    var scheduleFile = options.file;
        fs.readFile(scheduleFile,'utf8',function(er,data){
      if(er){
        throw new Error('could not read schedule file'+scheduleFile);
      } else {     
          runWithSchedule(data);        
      }
    });
  }else{
    scheduleFile = __dirname + '/schedule.json';
  }

  
  
  function runWithSchedule(data){
    // validate schedule data
    // it's actually synchronous shhh
    scheduleValidator.validate(data,function(error,nbds){
      if(error){
        throw new Error(error);
      }
      else if(nbds && nbds.length > 0){
        console.log( ('SCHEDULE WARNINGS:::::\n'+(nbds.join('\n'))).yellow );
      }else{
        console.log('schedule checks all OK'.green);
      }
    });

    schedule =  JSON.parse(data);
    
    // set timeout to generate new guide every minute
    setInterval(newGuide,60000);
    
    
    // show name was specified
    if (options.show){
      
      function normalize(str){
        //remove whitespace and lowercase when comparing
        return str.replace(/(\ |\_)+/ig, '').toLowerCase();
      }
      
      var showNormalized = normalize(options.show);
      var s = _.find(schedule.jobs,function(j){
          return ( normalize(j.name).indexOf( showNormalized ) > -1 )
        });
        
      if (!s){
        throw new Error('Can\'t find specified show: '+options.show);
      }
      //play that show as commercials... so play them at random (not shuffled!)
      tvPlayer.registerCommercials([s]);
      tvPlayer.clearShows();
      
    }else{//show was not specified, read schedule as normal
      // register commercials
      tvPlayer.registerCommercials(schedule.commercials);
      // schedule shows to play per schedule.json
      tvPlayer.clearShows();
      tvPlayer.registerShows(schedule.jobs);
    }

    tvPlayer.run(_.extend({},schedule.options,options));

    // generate a new guide right now
    newGuide();
    
    // launch express app
    expressApp();       
  }

  function newGuide(){
    var generator = guideGen(schedule);
    guide = generator.getGuide();  
    guideNext = generator.getNext();
  }
  
  function expressApp(){
    var app = express();
    
    function lightCaching(req,res,next){
      res.setHeader('Cache-Control', 'max-age=300');
      next();
    }
    
    app.get('/serverState.json',function(req,res){
      res.json(getState());   
    });
    
    app.post('/override',function(req,res){
      
      var doOStr = req.query.doOverride;
      if (doOStr){
        doOStr = doOStr.toLowerCase()
        if(doOStr == 'false'){//don't override
          tvPlayer.setOverrideMode(false);
          return res.json(setOverride(false));
        }else if (doOStr = 'true'){//do override
          tvPlayer.setOverrideMode(true);
          return res.json(setOverride(true));
        }
      }else{
        res.status(400);
        res.send('override parameter not specified!');
      }
      
    });
    
    app.post('/skipEpisode',function(req,res){
      tvPlayer.skipEpisode();
      res.status(200);
      res.send('ok :)');
    });
    
    app.post('/playShow',function(req,res){
      var show = req.query.show;
      if (!show){
        res.status(400);
        return res.send('need to specify a show name');
      }
      tvPlayer.playJobByName(show);
      res.status(200);
      return res.send('ok :)');      
    });

    app.get('/guide.json',lightCaching,function(req,res){
      res.send(guide);
    });

    app.get('/next.json',function(req,res){      
      res.send(guideNext);
    });

    app.use( serveStatic(__dirname + '/public') );

    var port = options.port || process.env.PORT || process.env.port || 8000;
    app.listen(port,function(){
      console.log('listening on port ',port);
    });
    

    
  }
  
  var serverState = {};
  function getState(){
    return serverState;      
  }
  function setOverride(o){
    serverState.override = o;
    // change the playback mode
    return serverState;
  }
  
  
}

// catch stupid epipe errors... throw on others

process.stdout.on('error',function(er){
  if (er.code === 'EPIPE'){
    // hon hon hon
    return;
  }else{
    process.stdout.removeAllListeners();
    process.stdout.emit('error', er);
  }
});