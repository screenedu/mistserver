/// \file player.cpp
/// Holds all code for the MistPlayer application used for VoD streams.

#if DEBUG >= 4
#include <iostream>//for std::cerr
#endif

#include <stdio.h> //for fileno
#include <sys/time.h>
#include <mist/dtsc.h>
#include <mist/json.h>
#include <mist/config.h>
#include <mist/socket.h>

/// Gets the current system time in milliseconds.
long long int getNowMS(){
  timeval t;
  gettimeofday(&t, 0);
  return t.tv_sec * 1000 + t.tv_usec/1000;
}//getNowMS

int main(int argc, char** argv){
  Util::Config conf(argv[0], PACKAGE_VERSION);
  conf.addOption("filename", JSON::fromString("{\"arg_num\":1, \"help\":\"Name of the file to write to stdout.\"}"));
  conf.parseArgs(argc, argv);
  conf.activate();
  int playing = 0;

  DTSC::File source = DTSC::File(conf.getString("filename"));
  Socket::Connection in_out = Socket::Connection(fileno(stdout), fileno(stdin));
  std::string meta_str = source.getHeader();
  JSON::Value pausemark;
  pausemark["datatype"] = "pause_marker";
  pausemark["time"] = (long long int)0;
  
  //send the header
  {
    in_out.Send("DTSC");
    unsigned int size = htonl(meta_str.size());
    in_out.Send((char*)&size, 4);
    in_out.Send(meta_str);
  }

  JSON::Value meta = JSON::fromDTMI(meta_str);
  JSON::Value last_pack;

  long long now, timeDiff = 0, lastTime = 0;

  while (in_out.connected()){
    if (in_out.spool()){
      while (in_out.Received().find('\n') != std::string::npos){
        std::string cmd = in_out.Received().substr(0, in_out.Received().find('\n'));
        in_out.Received().erase(0, in_out.Received().find('\n')+1);
        if (cmd != ""){
          switch (cmd[0]){
            case 'P':{ //Push
              #if DEBUG >= 4
              std::cerr << "Received push - ignoring (" << cmd << ")" << std::endl;
              #endif
              in_out.close();//pushing to VoD makes no sense
            } break;
            case 'S':{ //Stats
              #if DEBUG >= 4
              //std::cerr << "Received stats - ignoring (" << cmd << ")" << std::endl;
              #endif
              /// \todo Parse stats command properly.
              /* Stats(cmd.substr(2)); */
            } break;
            case 's':{ //second-seek
              #if DEBUG >= 4
              std::cerr << "Received ms-seek (" << cmd << ")" << std::endl;
              #endif
              int ms = JSON::Value(cmd.substr(2)).asInt();
              bool ret = source.seek_time(ms);
              #if DEBUG >= 4
              std::cerr << "Second-seek completed (time " << ms << "ms) " << ret << std::endl;
              #endif
            } break;
            case 'f':{ //frame-seek
              #if DEBUG >= 4
              std::cerr << "Received frame-seek (" << cmd << ")" << std::endl;
              #endif
              bool ret = source.seek_frame(JSON::Value(cmd.substr(2)).asInt());
              #if DEBUG >= 4
              std::cerr << "Frame-seek completed " << ret << std::endl;
              #endif
            } break;
            case 'p':{ //play
              #if DEBUG >= 4
              std::cerr << "Received play" << std::endl;
              #endif
              playing = -1;
              in_out.setBlocking(false);
            } break;
            case 'o':{ //once-play
              #if DEBUG >= 4
              std::cerr << "Received once-play" << std::endl;
              #endif
              if (playing <= 0){playing = 1;}
              ++playing;
              in_out.setBlocking(false);
            } break;
            case 'q':{ //quit-playing
              #if DEBUG >= 4
              std::cerr << "Received quit-playing" << std::endl;
              #endif
              playing = 0;
              in_out.setBlocking(true);
            } break;
          }
        }
      }
    }
    if (playing != 0){
      now = getNowMS();
      if (playing > 0 || now - timeDiff >= lastTime || lastTime - (now - timeDiff) > 15000) {
        source.seekNext();
        lastTime = source.getJSON()["time"].asInt();
        if ((now - timeDiff - lastTime) > 5000 || (now - timeDiff - lastTime < -5000)){
          timeDiff = now - lastTime;
        }
        if (source.getJSON().isMember("keyframe")){
          if (playing > 0){--playing;}
          if (playing == 0){
            #if DEBUG >= 4
            std::cerr << "Sending pause_marker" << std::endl;
            #endif
            pausemark["time"] = (long long int)now;
            pausemark.toPacked();
            in_out.Send(pausemark.toNetPacked());
            in_out.flush();
            in_out.setBlocking(true);
          }
        }
        if (playing != 0){
          //insert proper header for this type of data
          in_out.Send("DTPD");
          //insert the packet length
          unsigned int size = htonl(source.getPacket().size());
          in_out.Send((char*)&size, 4);
          in_out.Send(source.getPacket());
        }
      } else {
        usleep(std::min(10000LL, lastTime - (now - timeDiff)) * 1000);
      }
    }
    usleep(10000);//sleep 10ms
  }
  return 0;
}
