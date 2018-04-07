// ========= HOMEBRIDGE SESAME ========= //

// Instantiate global resources
var request = require("request");
var chalk = require("chalk");
var jar = request.jar();
var Accessory, Service, Characteristic, UUIDGen;

// Prepare the global exports
module.exports = function(homebridge) {
  Accessory = homebridge.platformAccessory;
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  UUIDGen = homebridge.hap.uuid;
  homebridge.registerPlatform("homebridge-Sesame", "Sesame", SesamePlatform, true);
}

// Startup the platform
function SesamePlatform(log, config, api) {
  this.log = log;
  this.platformLog = function(msg) {
    log(chalk.cyan("[Sesame]"), msg);
  };
  // If Sesame is loaded, but not configured we'll add it to the running config
  // We can look at configuration in the UI later on 
  this.config = config || {
    "platform": "Sesame"
  };
  this.username = this.config.username;
  this.password = this.config.password;
	this.url = "https://api.candyhouse.co/v1/";
	this.token = false;
	this.lockID = false;
	this.headers = { 
		'Content-Type' : 'application/json' 
	};
  this.securityToken = this.config.securityToken;
  this.longPoll = parseInt(this.config.longPoll, 10) || 300;
  this.shortPoll = parseInt(this.config.shortPoll, 10) || 5;
  this.shortPollDuration = parseInt(this.config.shortPollDuration, 10) || 120;
  this.scheduler = null;
  this.maxCount = this.shortPollDuration / this.shortPoll;
  this.count = this.maxCount;
  this.validData = false;
  this.ContentType = "application/json";
  this.manufacturer = "CANDY HOUSE";
  this.accessories = {};
  if (api) {
    this.api = api;
    this.api.on('didFinishLaunching', this.didFinishLaunching.bind(this));
  }
  // Definition Mapping
  this.lockState = ["unlock", "lock"];
}

// Method to restore accessories from cache
SesamePlatform.prototype.configureAccessory = function(accessory) {
    var self = this;
    var accessoryID = accessory.context.deviceID;
    accessory.context.log = function(msg) {
        self.log(chalk.cyan("[" + accessory.displayName + "]"), msg);
    };
    this.setService(accessory);
    this.accessories[accessoryID] = accessory;
}

// Method to setup accesories from config.json
SesamePlatform.prototype.didFinishLaunching = function() {
    if (this.username && this.password) {
        // Add or update accessory in HomeKit
        this.addAccessory();
        this.periodicUpdate();
    } else {
        this.platformLog("Please make sure the Sesame login information is set!")
    }
}

// Method to add or update HomeKit accessories
SesamePlatform.prototype.addAccessory = function() {
    var self = this;
    this.login(function(error) {
        if (!error) {
            for (var deviceID in self.accessories) {
                var accessory = self.accessories[deviceID];
                if (!accessory.reachable) {
                    // Remove extra accessories in cache
                    self.removeAccessory(accessory);
                } else {
                    // Update inital state
                    self.updatelockStates(accessory);
                }
            }
        }
    });
}

// Method to remove accessories from HomeKit
SesamePlatform.prototype.removeAccessory = function(accessory) {
    if (accessory) {
        var deviceID = accessory.context.deviceID;
        accessory.context.log("Removed from HomeBridge.");
        this.api.unregisterPlatformAccessories("homebridge-Sesame", "Sesame", [accessory]);
        delete this.accessories[deviceID];
    }
}

// Method to setup listeners for different events
SesamePlatform.prototype.setService = function(accessory) {
    accessory.getService(Service.LockMechanism).getCharacteristic(Characteristic.LockCurrentState).on('get', this.getState.bind(this, accessory));
    accessory.getService(Service.LockMechanism).getCharacteristic(Characteristic.LockTargetState).on('get', this.getState.bind(this, accessory)).on('set', this.setState.bind(this, accessory));
    accessory.getService(Service.BatteryService).getCharacteristic(Characteristic.BatteryLevel);
    accessory.getService(Service.BatteryService).getCharacteristic(Characteristic.StatusLowBattery);
	  accessory.getService(Service.BatteryService).getCharacteristic(Characteristic.ChargingState);
    accessory.on('identify', this.identify.bind(this, accessory));
}

// Method to setup HomeKit accessory information
SesamePlatform.prototype.setAccessoryInfo = function(accessory) {
    if (this.manufacturer) {
        accessory.getService(Service.AccessoryInformation).setCharacteristic(Characteristic.Manufacturer, this.manufacturer);
    }
    if (accessory.context.serialNumber) {
        accessory.getService(Service.AccessoryInformation).setCharacteristic(Characteristic.SerialNumber, accessory.context.serialNumber);
    }
    if (accessory.context.model) {
        accessory.getService(Service.AccessoryInformation).setCharacteristic(Characteristic.Model, accessory.context.model);
    }
}

// Method to set target lock state
SesamePlatform.prototype.setState = function(accessory, state, callback) {
    var self = this;
    // Always re-login for setting the state
    this.getDevice(function(getlocksError) {
        if (!getlocksError) {
            self.setState(accessory, state, function(setStateError) {
                callback(setStateError);
            });
        } else {
            callback(getlocksError);
        }
    });
}

// Method to get target lock state
SesamePlatform.prototype.getState = function(accessory, callback) {
    // Get target state directly from cache
    callback(null, accessory.context.currentState);
}

// Method to get current lock state
SesamePlatform.prototype.getCurrentState = function(accessory, callback) {
    var self = this;
    var thisOpener = accessory.context;
    var name = accessory.displayName;
    // Retrieve latest state from server
    this.updateState(function(error) {
        if (!error) {
            thisOpener.log("Getting current state: " + self.lockState[thisOpener.currentState]);
            callback(null, thisOpener.currentState);
        } else {
            callback(error);
        }
    });
}

// Method for state periodic update
SesamePlatform.prototype.periodicUpdate = function() {
    var self = this;
    // Determine polling interval
    if (this.count < this.maxCount) {
        this.count++;
        var refresh = this.shortPoll;
    } else {
        var refresh = this.longPoll;
    }
    // Setup periodic update with polling interval
    this.scheduler = setTimeout(function() {
        self.scheduler = null
        self.updateState(function(error) {
            if (!error) {
                // Update states for all the locks
                for (var deviceID in self.accessories) {
                    var accessory = self.accessories[deviceID];
                    self.updatelockStates(accessory);
                }
            } else {
                // Login again after short polling interval if error occurs
                self.count = self.maxCount - 1;
            }
            // Setup next polling
            self.periodicUpdate();
        });
    }, refresh * 1000);
}

// Method to update lock state in HomeKit
SesamePlatform.prototype.updatelockStates = function(accessory) {
    accessory.getService(Service.LockMechanism).setCharacteristic(Characteristic.LockCurrentState, accessory.context.currentState);
    accessory.getService(Service.LockMechanism).getCharacteristic(Characteristic.LockTargetState).getValue();
    accessory.getService(Service.BatteryService).setCharacteristic(Characteristic.BatteryLevel, accessory.context.batt);
    accessory.getService(Service.BatteryService).setCharacteristic(Characteristic.StatusLowBattery, accessory.context.low);
    // We'll set the charging state to 3, the magic number for not chargeable
    accessory.getService(Service.BatteryService).setCharacteristic(Characteristic.ChargingState, 3);
}

// Method to retrieve lock state from the server
SesamePlatform.prototype.updateState = function(callback) {
    if (this.validData) {
        // Refresh data directly from sever if current data is valid
        this.getDevice(callback);
    } else {
        // Re-login if current data is not valid
        this.login(callback);
    }
}

// Method to handle identify request
SesamePlatform.prototype.identify = function(accessory, paired, callback) {
    accessory.context.log("Identify requested!");
    callback();
}

// Login to the CANDY HOUSE API and get our token
SesamePlatform.prototype.login = function(callback) {
    var self = this;
  	self.platformLog("Attempting to login to CANDY HOUSE..."); 
	request({
   		method: "POST",
    	json: true,
		url: self.url + "accounts/login",
		headers: self.headers,
		body: { 	
			"email": self.username, 
			"password": self.password 
		}
	}, function(error, response, body) {
			if (!error && response.statusCode == 200) {
				self.platformLog("Logged in as " + self.username + "...");
				self.postLogin(callback);
				self.securityToken = body.authorization;
				// Update header to include token
				self.headers = { 
						'X-Authorization': self.securityToken,
						'Content-Type' : 'application/json' 
					};
				self.platformLog("Set the API request header with token.");
            	self.postLogin(callback);
			} else {
				self.platformLog("Error: " + response.statusCode + " logging into CANDY HOUSE. Credential issue, API throttling or server downtime...");
				callback(error, null);
			}	
	});
}

SesamePlatform.prototype.postLogin = function(accessory, paired, getlocks, callback) {
    var self = this;
    self.getlocks(accessory);
}

SesamePlatform.prototype.getlocks = function(callback) {
    var self = this;
    require('request').get({
        url: self.url + "sesames",
		headers: self.headers,
    }, function(error, request, body) {
        if (!error && request.statusCode == 200) {
			var json = JSON.parse(body);
			json = json.sesames;
			self.platformLog("Got a Sesames JSON from CANDY HOUSE!"); 	
            self.lockids = Object.keys(json);
            for (var i = 0; i < self.lockids.length; i++) {
                self.lock = json[self.lockids[i]];
                self.lockname = self.lock.nickname;
                self.platformLog("Lock: " + self.lockname);
                self.getDevice(callback);
            }
			callback(null, json); 
        }
    }).on('error', function(error) {
        self.platformLog(error);
        callback(error, null);
    });
}

SesamePlatform.prototype.getDevice = function(callback, state) {
  var self = this;
  this.validData = false;
  // Reset validData hint until we retrived data from the server
  // Querystring params
  require('request').get({
    uri: self.url + "sesames/" + self.lock.device_id,
    headers: self.headers
  }, function(error, request, body) {
    self.platformLog(body);        
    if (!error && request.statusCode == 200) {
      var locks = JSON.parse(body);			
      var thisDeviceID = self.lock.device_id;
      var thisSerialNumber = self.lock.device_id;
      var thisModel = "Sesame";
      var thislockName = locks.nickname;
      var state = locks.is_unlocked;
      var thishome = locks.nickname;
      self.batt = locks.battery;
      if (self.batt < 20) {
        lowbatt = Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW;
        var newbatt = Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW;
      } else if (self.batt > 20) {
        lowbatt = Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
        var newbatt = Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
      }
      // Initialization for opener
      if (!self.accessories[thisDeviceID]) {
        var uuid = UUIDGen.generate(thisDeviceID);
        // Setup accessory 
        var newAccessory = new Accessory("Sesame " + thishome, uuid, 6);
        // New accessory found in the server is always reachable
        newAccessory.reachable = true;
        // Store and initialize variables into context
        newAccessory.context.deviceID = thisDeviceID;
        newAccessory.context.initialState = Characteristic.LockCurrentState.SECURED;
        newAccessory.context.currentState = Characteristic.LockCurrentState.SECURED;
        newAccessory.context.serialNumber = thisSerialNumber;
        newAccessory.context.home = thishome;
        newAccessory.context.model = thisModel;
        newAccessory.context.batt = self.batt;
        newAccessory.context.low = self.low;
        newAccessory.context.log = function(msg) {
          self.log(chalk.cyan("[" + newAccessory.displayName + "]"), msg);
        };
        // Setup HomeKit security systemLoc service
        newAccessory.addService(Service.LockMechanism, thislockName);
        newAccessory.addService(Service.BatteryService);
        // Setup HomeKit accessory information
        self.setAccessoryInfo(newAccessory);
        // Setup listeners for different security system events
        self.setService(newAccessory);
        // Register accessory in HomeKit
        self.api.registerPlatformAccessories("homebridge-Sesame", "Sesame", [newAccessory]);
      } else {
        // Retrieve accessory from cache
        var newAccessory = self.accessories[thisDeviceID];
        // Update context
        newAccessory.context.deviceID = thisDeviceID;
        newAccessory.context.serialNumber = thisSerialNumber;
        newAccessory.context.model = thisModel;
        newAccessory.context.home = thishome;
        // Accessory is reachable after it's found in the server
        newAccessory.updateReachability(true);
      }
      if (self.batt) {
          newAccessory.context.low = (self.batt > 20) ? Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL : Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW;
      }
      if (state == false) {
          newAccessory.context.initialState = Characteristic.LockCurrentState.UNSECURED;
          var newState = Characteristic.LockCurrentState.SECURED;
      } else if (state == true) {
          newAccessory.context.initialState = Characteristic.LockCurrentState.UNSECURED;
          var newState = Characteristic.LockCurrentState.UNSECURED;
      }
      // Detect for state changes
      if (newState !== newAccessory.context.currentState) {
          self.count = 0;
          newAccessory.context.currentState = newState;
      }
      // Store accessory in cache
      self.accessories[thisDeviceID] = newAccessory;
      // Set validData hint after we found an opener
      self.validData = true;
    }
    // Did we get valid data?
    if (self.validData) {
      // Set short polling interval when state changes
      if (self.scheduler && self.count == 0) {
        clearTimeout(self.scheduler);
        self.periodicUpdate();
      }
      callback();
    } else {
      self.platformLog("Error: Couldn't find a Sesame.");
      callback("Missing Sesame device ID...");
    }
  }).on('error', function(error) {
    self.platformLog("Error '" + error + "'" + "lock null");
  });
}

// Send opener target state to the server
SesamePlatform.prototype.setState = function(accessory, state, callback) {
  var self = this;
  var thisOpener = accessory.context;
  var name = accessory.displayName;
  var sesameState = (state == Characteristic.LockTargetState.SECURED) ? "lock" : "unlock";
  var status = self.lockState[state]; 
	var controlURL = self.url + "sesames/" + accessory.context.serialNumber + "/control"
	self.platformLog(accessory);
  self.platformLog(controlURL);
	request({
    method: "POST",
    json: true,
    url: controlURL,
    headers: self.headers,
    body: { "type": sesameState }
	}, function(error, response, body) {
    if (!error && response.statusCode == 204) {
      self.log("State change complete.");
      thisOpener.log("State was successfully set to " + status);
      // Set short polling interval
      self.count = 0;
      if (self.scheduler) {
        clearTimeout(self.scheduler);
        self.periodicUpdate();
      }
      callback(error, state)
		} else {
      thisOpener.log("Error '" + error + "' setting lock state: " + body);
      self.removeAccessory(accessory);
      callback(error);
		}
  }).on('error', function(error) {
    thisOpener.log(error);
    callback(error);
  });    
}