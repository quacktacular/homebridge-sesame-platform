# homebridge-sesame-platform

This is a [Homebridge plugin](https://github.com/nfarina/homebridge) that allows you to control [Sesame smart locks](https://candyhouse.co) with Siri by integrating with HomeKit.

Currently these features are supported:

 * _Lock the Sesame_
 * _Unlock the Sesame_
 * _Supports multiple locks_
 * _Check the current state_ 
 * _Check the battery level_
 * _Battery low warning_
 * _Auto updates state in HomeKit_
 * _Shows serial number in Home_

In order to use *homebridge-sesame-platform* you must have: 

1. A Sesame smart lock with API access enabled
2. The Vritual Station app or WiFi Access Point
3. NodeJS and NPM installed
4. Homebridge installed (with accessory added to config.json)

# Installation

You can install via NPM by issuing the following command:
```
sudo npm install -g homebridge-sesame-beta
```
Then you should update your Homebridge config.json with an accessory entry for each Sesame.
 ```
    "platforms": [
        {
            "platform": "Sesame",
            "username": "youemail@whatever.net",
            "password": "S0m3_S3cuR3_P455w0rD"
        }
    ]
```