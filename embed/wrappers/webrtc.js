mistplayers.webrtc = {
  name: "WebRTC player",
  mimes: ["webrtc"],
  priority: MistUtil.object.keys(mistplayers).length + 1,
  isMimeSupported: function (mimetype) {
    return (this.mimes.indexOf(mimetype) == -1 ? false : true);
  },
  isBrowserSupported: function (mimetype,source,MistVideo) {
    
    if ((!("WebSocket" in window)) || (!("RTCPeerConnection" in window))) { return false; }
    
    //check for http/https mismatch
    if (location.protocol.replace(/^http/,"ws") != MistUtil.http.url.split(source.url.replace(/^http/,"ws")).protocol) {
      MistVideo.log("HTTP/HTTPS mismatch for this source");
      return false;
    }
    
    return true;
  },
  player: function(){}
};
var p = mistplayers.webrtc.player;
p.prototype = new MistPlayer();
p.prototype.build = function (MistVideo,callback) {
  var me = this;
  
  if ((typeof WebRTCBrowserEqualizerLoaded == "undefined") || (!WebRTCBrowserEqualizerLoaded)) {
    //load it
    var scripttag = document.createElement("script");
    scripttag.src = MistVideo.urlappend(MistVideo.options.host+"/webrtc.js");
    MistVideo.log("Retrieving webRTC browser equalizer code from "+scripttag.src);
    document.head.appendChild(scripttag);
    scripttag.onerror = function(){
      MistVideo.showError("Failed to load webrtc browser equalizer",{nextCombo:5});
    }
    scripttag.onload = function(){
      me.build(MistVideo,callback);
    }
    return;
  }
  
  var video = document.createElement("video");
  
  //apply options
  var attrs = ["autoplay","loop","poster"];
  for (var i in attrs) {
    var attr = attrs[i];
    if (MistVideo.options[attr]) {
      video.setAttribute(attr,(MistVideo.options[attr] === true ? "" : MistVideo.options[attr]));
    }
  }
  if (MistVideo.options.muted) {
    video.muted = true; //don't use attribute because of Chrome bug
  }
  if (MistVideo.info.type == "live") {
    video.loop = false;
  }
  if (MistVideo.options.controls == "stock") {
    video.setAttribute("controls","");
  }
  video.setAttribute("crossorigin","anonymous");
  this.setSize = function(size){
    video.style.width = size.width+"px";
    video.style.height = size.height+"px";
  };
  MistUtil.event.addListener(video,"loadeddata",correctSubtitleSync);
  MistUtil.event.addListener(video,"seeked",correctSubtitleSync);
  
  var seekoffset = 0;
  var hasended = false;
  this.listeners = {
    on_connected: function() {
      seekoffset = 0;
      hasended = false;
      this.webrtc.play();
      MistUtil.event.send("webrtc_connected",null,video);
    },
    on_disconnected: function() {
      MistUtil.event.send("webrtc_disconnected",null,video);
      MistVideo.log("Websocket sent on_disconnect");
      /*
        If a VoD file ends, we receive an on_stop, but no on_disconnect
        If a live stream ends, we receive an on_disconnect, but no on_stop
        If MistOutWebRTC crashes, we receive an on_stop and then an on_disconnect
      */
      if (hasended) {
        MistVideo.showError("Connection to media server ended unexpectedly.");
      }
      video.pause();
    },
    on_answer_sdp: function (ev) {
      if (!ev.result) {
        MistVideo.showError("Failed to open stream.");
        this.on_disconnected();
        return;
      }
      MistVideo.log("SDP answer received");
    },
    on_time: function(ev) {
      //timeupdate
      var oldoffset = seekoffset;
      seekoffset = ev.current*1e-3 - video.currentTime;
      if (Math.abs(oldoffset - seekoffset) > 1) { correctSubtitleSync(); }
      
      var d = (ev.end == 0 ? Infinity : ev.end*1e-3);
      if (d != duration) {
        duration = d;
        MistUtil.event.send("durationchange",d,video);
      }
      
      if (currenttracks != ev.tracks) {
        var tracks = MistUtil.tracks.parse(MistVideo.info.meta.tracks);
        for (var i in ev.tracks) {
          if (currenttracks.indexOf(ev.tracks[i]) < 0) {
            //find track type
            var type;
            for (var j in tracks) {
              if (ev.tracks[i] in tracks[j]) {
                type = j;
                break;
              }
            }
            if (!type) {
              //track type not found, this should not happen
              continue;
            }
            
            //create an event to pass this to the skin
            MistUtil.event.send("playerUpdate_trackChanged",{
              type: type,
              trackid: ev.tracks[i]
            },MistVideo.video);
          }
        }

        currenttracks = ev.tracks;
      }
    },
    on_seek: function(e){
      var thisPlayer = this;
      MistUtil.event.send("seeked",seekoffset,video);
      
      //set playback rate to auto if seek was to live point
      if (e.live_point) {
        thisPlayer.webrtc.playbackrate("auto");
      }
      
      if ("seekPromise" in this.webrtc.signaling){
        video.play().then(function(){
          if ("seekPromise" in thisPlayer.webrtc.signaling) {
            thisPlayer.webrtc.signaling.seekPromise.resolve("Play promise resolved");
          }
        }).catch(function(){
          if ("seekPromise" in thisPlayer.webrtc.signaling) {
            thisPlayer.webrtc.signaling.seekPromise.reject("Play promise rejected");
          }
        });
      }
      else { video.play(); }
    },
    on_speed: function(e){
      this.webrtc.play_rate = e.play_rate_curr;
      MistUtil.event.send("ratechange",e,video);
    },
    on_stop: function(){
      MistVideo.log("Websocket sent on_stop");
      MistUtil.event.send("ended",null,video);
      hasended = true;
    }
  };
  
  
  function WebRTCPlayer(){
    this.peerConn = null;
    this.localOffer = null;
    this.isConnected = false;
    this.play_rate = "auto";
    var thisWebRTCPlayer = this;
    
    this.on_event = function(ev) {
      //if (ev.type != "on_time") { console.log(ev); }
      switch (ev.type) {
        case "on_connected": {
          thisWebRTCPlayer.isConnected = true;
          break;
        }
        case "on_answer_sdp": {
          thisWebRTCPlayer.peerConn
          .setRemoteDescription({ type: "answer", sdp: ev.answer_sdp  })
          .then(function(){}, function(err) {
            console.error(err);
          });
          break;
        }
        case "on_disconnected": {
          thisWebRTCPlayer.isConnected = false;
          break;
        }
      }
      if (ev.type in me.listeners) {
        return me.listeners[ev.type].call(me,ev);
      }
      MistVideo.log("Unhandled WebRTC event "+ev.type+": "+JSON.stringify(ev));
      return false;
    };
    
    this.connect = function(callback){
      thisWebRTCPlayer.signaling = new WebRTCSignaling(thisWebRTCPlayer.on_event);
      thisWebRTCPlayer.peerConn = new RTCPeerConnection();
      thisWebRTCPlayer.peerConn.ontrack = function(ev) {
        video.srcObject = ev.streams[0];
        if (callback) { callback(); }
      };
    };
    
    this.play = function(){
      if (!this.isConnected) {
        throw "Not connected, cannot play";
      }
      
      this.peerConn
      .createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
      })
      .then(function(offer){
        thisWebRTCPlayer.localOffer = offer;
        thisWebRTCPlayer.peerConn
        .setLocalDescription(offer)
        .then(function(){
          thisWebRTCPlayer.signaling.sendOfferSDP(thisWebRTCPlayer.localOffer.sdp);
        }, function(err){console.error(err)});
      }, function(err){ throw err; });
    };
    
    this.stop = function(){
      if (!this.isConnected) { throw "Not connected, cannot stop." }
      this.signaling.send({type: "stop"});
    };
    this.seek = function(seekTime){
      var p = new Promise(function(resolve,reject){
        if (!thisWebRTCPlayer.isConnected || !thisWebRTCPlayer.signaling) { return reject("Failed seek: not connected"); }
        thisWebRTCPlayer.signaling.send({type: "seek", "seek_time": seekTime*1e3});
        if ("seekPromise" in thisWebRTCPlayer.signaling) {
          thisWebRTCPlayer.signaling.seekPromise.reject("Doing new seek");
        }
        
        thisWebRTCPlayer.signaling.seekPromise = {
          resolve: function(msg){
            resolve("seeked");
            delete thisWebRTCPlayer.signaling.seekPromise;
          },
          reject: function(msg) {
            reject("Failed to seek: "+msg);
            delete thisWebRTCPlayer.signaling.seekPromise;
          }
        };
      });
      return p;
    };
    this.pause = function(){
      if (!this.isConnected) { throw "Not connected, cannot pause." }
      this.signaling.send({type: "pause"});
    };
    this.setTrack = function(obj){
      if (!this.isConnected) { throw "Not connected, cannot set track." }
      obj.type = "tracks";
      this.signaling.send(obj);
    };
    this.playbackrate = function(value) {
      if (typeof value == "undefined") {
        return (me.webrtc.play_rate == "auto" ? 1 : me.webrtc.play_rate);
      }
      
      if (!this.isConnected) { throw "Not connected, cannot change playback rate." }
      
      this.signaling.send({
        type: "set_speed",
        play_rate: value
      });
      
    };
    this.getStats = function(callback){
      this.peerConn.getStats().then(function(d){
        var output = {};
        var entries = Array.from(d.entries());
        for (var i in entries) {
          var value = entries[i];
          if (value[1].type == "inbound-rtp") {
            output[value[0]] = value[1];
          }
        }
        callback(output);
      });
    };
    //input only
    /*
    this.sendVideoBitrate = function(bitrate) {
      this.send({type: "video_bitrate", video_bitrate: bitrate});
    };
    */
    
    this.connect();
  }
  function WebRTCSignaling(onEvent){
    this.ws = null;
    
    this.ws = new WebSocket(MistVideo.source.url.replace(/^http/,"ws"));
    
    this.ws.onopen = function() {
      onEvent({type: "on_connected"});
    };
    
    this.ws.onmessage = function(e) {
      try {
        var cmd = JSON.parse(e.data);
        onEvent(cmd);
      }
      catch (err) {
        console.error("Failed to parse a response from MistServer",err,e.data);
      }
    };
    
    /* See http://tools.ietf.org/html/rfc6455#section-7.4.1 */
    this.ws.onclose = function(ev) {
      switch (ev.code) {
        default: {
          onEvent({type: "on_disconnected"});
          break;
        }
      }
    }
    
    this.sendOfferSDP = function(sdp) {
      this.send({type: "offer_sdp", offer_sdp: sdp});
    };
    this.send = function(cmd) {
      if (!this.ws) {
        throw "Not initialized, cannot send "+JSON.stringify(cmd);
      }
      this.ws.send(JSON.stringify(cmd));
    }
  };
  
  this.webrtc = new WebRTCPlayer();
  
  this.api = {};
  
  //override video duration
  var duration;
  var currenttracks = [];
  Object.defineProperty(this.api,"duration",{
    get: function(){ return duration; }
  });
  
  //override seeking
  Object.defineProperty(this.api,"currentTime",{
    get: function(){
      return seekoffset + video.currentTime;
    },
    set: function(value){
      seekoffset = value - video.currentTime;
      video.pause();
      me.webrtc.seek(value);
      MistUtil.event.send("seeking",value,video);
    }
  });
  
  //override playbackrate
  Object.defineProperty(this.api,"playbackRate",{
    get: function(){
      return me.webrtc.playbackrate();
    },
    set: function(value){
      return me.webrtc.playbackrate(value);
      //TODO send playbackrate changed event?
    }
  });
  
  //redirect properties
  //using a function to make sure the "item" is in the correct scope
  function reroute(item) {
    Object.defineProperty(me.api,item,{
      get: function(){ return video[item]; },
      set: function(value){
        return video[item] = value;
      }
    });
  }
  var list = [
    "volume"
    ,"muted"
    ,"loop"
    ,"paused",
    ,"error"
    ,"textTracks"
    ,"webkitDroppedFrameCount"
    ,"webkitDecodedFrameCount"
  ];
  for (var i in list) {
    reroute(list[i]);
  }
  
  //redirect methods
  function redirect(item) {
    if (item in video) {
      me.api[item] = function(){
        return video[item].call(video,arguments);
      };
    }
  }
  var list = ["load","getVideoPlaybackQuality"];
  for (var i in list) {
    redirect(list[i]);
  }
  
  //redirect play
  me.api.play = function(){
    if (me.api.currentTime) {
      var p = new Promise(function(resolve,reject){
        if ((!me.webrtc.isConnected) || (me.webrtc.peerConn.iceConnectionState != "completed")) {
          me.webrtc.connect(function(){
            me.webrtc.seek(me.api.currentTime).then(function(msg){
              resolve("played "+msg);
            }).catch(function(msg){
              reject(msg);
            });
          });
        }
        else {
          me.webrtc.seek(me.api.currentTime).then(function(msg){
            resolve("played "+msg);
          }).catch(function(msg){
            reject(msg);
          });
        }
      });
      return p;
    }
    else {
      return video.play();
    }
  };
  
  //redirect pause
  me.api.pause = function(){
    video.pause();
    try {
      me.webrtc.pause();
    }
    catch (e) {}
    MistUtil.event.send("paused",null,video);
  };
  
  me.api.setTracks = function(obj){
    if (me.webrtc.isConnected) {
      me.webrtc.setTrack(obj);
    }
    else {
      var f = function(){
        me.webrtc.setTrack(obj);
        MistUtil.event.removeListener({type: "webrtc_connected", callback: f, element: video});
      };
      MistUtil.event.addListener(video,"webrtc_connected",f);
    }
  };
  function correctSubtitleSync() {
    if (!me.api.textTracks[0]) { return; }
    var currentoffset = me.api.textTracks[0].currentOffset || 0;
    if (Math.abs(seekoffset - currentoffset) < 1) { return; } //don't bother if the change is small
    var newCues = [];
    for (var i = me.api.textTracks[0].cues.length-1; i >= 0; i--) {
      var cue = me.api.textTracks[0].cues[i];
      me.api.textTracks[0].removeCue(cue);
      if (!("orig" in cue)) {
        cue.orig = {start:cue.startTime,end:cue.endTime};
      }
      cue.startTime = cue.orig.start - seekoffset;
      cue.endTime = cue.orig.end - seekoffset;
      newCues.push(cue);
    }
    for (var i in newCues) {
      me.api.textTracks[0].addCue(newCues[i]);
    }
    me.api.textTracks[0].currentOffset = seekoffset;
  }
  me.api.setSubtitle = function(trackmeta) {
    //remove previous subtitles
    var tracks = video.getElementsByTagName("track");
    for (var i = tracks.length - 1; i >= 0; i--) {
      video.removeChild(tracks[i]);
    }
    if (trackmeta) { //if the chosen track exists
      //add the new one
      var track = document.createElement("track");
      video.appendChild(track);
      track.kind = "subtitles";
      track.label = trackmeta.label;
      track.srclang = trackmeta.lang;
      track.src = trackmeta.src;
      track.setAttribute("default","");
      
      //correct timesync
      track.onload = correctSubtitleSync;
    }
  };
  
  //loop
  MistUtil.event.addListener(video,"ended",function(){
    if (me.api.loop) {
      me.webrtc.connect();
    }
  });
  
  if ("decodingIssues" in MistVideo.skin.blueprints) {
    //get additional dev stats
    var vars = ["nackCount","pliCount","packetsLost","packetsReceived","bytesReceived"];
    for (var j in vars) {
      me.api[vars[j]] = 0;
    }
    var f = function() {
      MistVideo.timers.start(function(){
        me.webrtc.getStats(function(d){
          for (var i in d) {
            for (var j in vars) {
              if (vars[j] in d[i]) {
                me.api[vars[j]] = d[i][vars[j]];
              }
            }
            break;
          }
        });
        f();
      },1e3);
    };
    f();
  }
  
  me.api.unload = function(){
    try {
      me.webrtc.stop();
    } catch (e) {}
  };
  
  callback(video);
  
};
