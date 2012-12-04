#include <mist/json.h>
#include <mist/config.h>
#include <mist/procs.h>
#include "controller_storage.h"

namespace Controller{
  
  void CheckProtocols(JSON::Value & p){
    static std::map<std::string, std::string> current_connectors;
    std::map<std::string, std::string> new_connectors;
    std::map<std::string, std::string>::iterator iter;
    bool haveHTTPgeneric = false;
    bool haveHTTPspecific = false;

    std::string tmp;
    JSON::Value counter = (long long int)0;

    for (JSON::ArrIter ait = p.ArrBegin(); ait != p.ArrEnd(); ait++){
      if (!(*ait).isMember("connector") || (*ait)["connector"].asString() == ""){continue;}
      
      tmp = std::string("MistConn") + (*ait)["connector"].asString() + std::string(" -n");
      if ((*ait)["connector"].asString() == "HTTP"){haveHTTPgeneric = true;}
      if ((*ait)["connector"].asString() != "HTTP" && (*ait)["connector"].asString().substr(0, 4) == "HTTP"){haveHTTPspecific = true;}
    
      if ((*ait).isMember("port") && (*ait)["port"].asInt() != 0){
        tmp += std::string(" -p ") + (*ait)["port"].asString();
      }
    
      if ((*ait).isMember("interface") && (*ait)["interface"].asString() != "" && (*ait)["interface"].asString() != "0.0.0.0"){
        tmp += std::string(" -i ") + (*ait)["interface"].asString();
      }

      if ((*ait).isMember("username") && (*ait)["username"].asString() != "" && (*ait)["username"].asString() != "root"){
        tmp += std::string(" -u ") + (*ait)["username"].asString();
      }

      if ((*ait).isMember("args") && (*ait)["args"].asString() != ""){
        tmp += std::string(" ") + (*ait)["args"].asString();
      }


      counter = counter.asInt() + 1;
      new_connectors[std::string("Conn")+counter.asString()] = tmp;
      if (Util::Procs::isActive(std::string("Conn")+counter.asString())){
        (*ait)["online"] = 1;
      }else{
        (*ait)["online"] = 0;
      }
    }

    //shut down deleted/changed connectors
    for (iter = current_connectors.begin(); iter != current_connectors.end(); iter++){
      if (new_connectors.count(iter->first) != 1 || new_connectors[iter->first] != iter->second){
        Log("CONF", "Stopping connector: " + iter->second);
        Util::Procs::Stop(iter->first);
      }
    }

    //start up new/changed connectors
    for (iter = new_connectors.begin(); iter != new_connectors.end(); iter++){
      if (current_connectors.count(iter->first) != 1 || current_connectors[iter->first] != iter->second || !Util::Procs::isActive(iter->first)){
        Log("CONF", "Starting connector: " + iter->second);
        Util::Procs::Start(iter->first, Util::getMyPath() + iter->second);
      }
    }

    if (haveHTTPgeneric && !haveHTTPspecific){
      Log("WARN", "HTTP Connector is enabled but no HTTP-based protocols are active!");
    }
    if (!haveHTTPgeneric && haveHTTPspecific){
      Log("WARN", "HTTP-based protocols will not work without the generic HTTP connector!");
    }

    //store new state
    current_connectors = new_connectors;
  }

  
}
