/*
 * scalegateway: a Raspberry Pi gateway that transfers
 * mesurements from the Curie BLE Weight scale to the cloud.
 *
 * Status:
 * Not ready for use; lots of development remains.
 * This currently contains too much code from noble's test.js
 * and will be rewritten.
 * Currently: sort of reads a single weight measurement from the scale.
 * 
 * 
 * Copyright (c) 2016 Bradford Needham, North Plains, Oregon, USA
 * @bneedhamia, https://www.needhamia.com
 * Licensed under the GPL 2, a copy of which
 * should have been included with this software.
 */

var noble = require('noble');  // npm install noble  (see https://github.com/sandeepmistry/noble)

// CONFIG_FILENAME = the local file containing our configuration. See readAppConfig().
const CONFIG_FILENAME = 'properties.json';

/*
 * USER_* - BLE "User" Ids for the scale's reported weights.
 * It reports multiple weights per measurement as the weights of 5 Users
 *
 * USER_TOTAL = The User Id representing the total weight on the scale.
 * USER_UL = The User Id representing the weight on the Upper-left Load Sensor.
 * USER_LL = the same for the Lower-Left Load Sensor.
 * USER_UR = the same for the Upper-Right Load Sensor.
 * USER_LR = the same for the Lower-Right Load Sensor.
 *
 * NUM_USERS = the number of different "Users" we report.
 *
 * USER_RESET = the User Id indicating that the scale has been reset.
 *   Not considered one of the regularly-reported users.
 */

const USER_TOTAL = 0;
const USER_UL = 1;
const USER_LL = 2;
const USER_UR = 3;
const USER_LR = 4;
const NUM_USERS = 5;
const USER_RESET = NUM_USERS;

var properties;		// global configuration, read from CONFIG_FILENAME

/*
 * Reads our application's configuration from a local file.
 * Sets the variable "properties".
 * On error, exits.
 *
 * That file should be a JSON file with the following names:
 *   "bleLocalName" Required, String. Advertised LocalName of the BLE weight scale to read from.
 */
function readAppConfig() {
  var bleLocalName;		// from properties file

  fs = require('fs');
  fs.readFile(CONFIG_FILENAME, 'utf8', function(err, data) {
    if (err) {
      console.log('Failed to read config file, ' + CONFIG_FILENAME + ': ' + err);
      process.exit(1);
    }
  
    properties = JSON.parse(data);

    // Check that the necessary properties are there.

    if (!properties.bleLocalName || properties.bleLocalName.length == 0) {
      console.log('Missing or blank bleLocalName in ' + CONFIG_FILENAME);
      process.exit();
    }
    console.log(properties.bleLocalName);
  });
};


readAppConfig();


noble.on('stateChange', function(state) {
  if (state === 'poweredOn') {
    noble.startScanning();
  } else {
    noble.stopScanning();
  }
});

noble.on('scanStart', function() {
  console.log('on -> scanStart');
});

noble.on('scanStop', function() {
  console.log('on -> scanStop');
});

noble.on('discover', function(peripheral) {
  console.log('on -> discover');

  peripheral.on('connect', function() {
    console.log('on -> connect');

    // We've successfully connected. Find what Services the device offers.
    this.discoverServices();
  });

  peripheral.on('disconnect', function() {
    console.log('on -> disconnect');
  });

  peripheral.on('servicesDiscover', function(services) {
    console.log('on -> peripheral services discovered');

    // Find the weight service, if it's advertised.  If not, we're done.

    var serviceIndex = -1;
    for (serviceIndex = 0; serviceIndex < services.length; ++serviceIndex) {
      if (services[serviceIndex].uuid == '181d') {
        break;
      }
    }
    if (serviceIndex >= services.length) {
      console.log('No ' + 'weight' + ' service found on device.');
      peripheral.disconnect();
      return;
    }

    services[serviceIndex].on('includedServicesDiscover', function(includedServiceUuids) {
      // Find the service's characteristics (gatts)
      this.discoverCharacteristics();
    });

    services[serviceIndex].on('characteristicsDiscover', function(characteristics) {
 
      /*
       * Parse the standard BLE Weight Measurement characteristic.
       *
       * See the BLE spec or the scale's Arduino Sketch for the format of this data:
       * [0] = flags
       * [1] = Weight least-significant byte
       * [2] = Weight most-significant byte
       * [0] = User ID (see USER_* above)
       *
       * Flag values:
       * bit 0 = 0 means we're reporting in SI units (kg and meters)
       * bit 1 = 0 means there is no time stamp in our report
       * bit 2 = 0 means no User ID is in our report
       * bit 3 = 0 means no BMI and Height are in our report
       * bits 4..7 are reserved, and set to zero.
       */
      function parseBleWeight(bleData) {
        var wFlags;		// flags for the weight encoding
        var userId;		// 'user' having this weight. See USER_* above
        var weightKg;		// the reported weight, in kilograms
        var i;

        // For debugging, report the bytes of data
        for (i = 0; i < bleData.length; ++i) {
          console.log(bleData[i]);
        }

        if (bleData.length != 4) {
          console.log('Garbled BLE Weight measurement: data length = ' + bleData.length);
          return;
        }

        // Check that the flags match our expectations
        wFlags = bleData[0];
        if ((wFlags & 0x01)) {  // we assume SI units
          console.log('Skipping unexpected Weight Flag: scale is reporting in Imperial units instead of SI units');
          return;
        }
        if ((wFlags & 0x02)) {  // we assume no timestamp
          console.log('Skipping unexpected Weight Flag: scale includes a timestamp');
          return;
        }
        if ((wFlags & 0x04) == 0) {  // we assume a user id
          console.log("Skipping unexpected Weight Flag: scale doesn't report user ID");
          //BUG: the scale says no user ID, but does include it.  return;
        }
        if ((wFlags & 0x08)) {  // we assume no BMI or Height
          console.log('Skipping unexpected Weight Flag: scale includes BMI and Height');
          return;
        }

        // Assemble the weight, scaled by the standard BLE value.
        weightKg = (bleData[2] << 8) + bleData[1];
        weightKg = (weightKg * 5.0) / 1000.0;

        userId = bleData[3];

        console.log('User ' + userId + ' weight: ' + weightKg + ' kg');
        
      }

      // Find the Weight Measurement Characteristic.
      var characteristicIndex = -1;
      for (characteristicIndex = 0; characteristicIndex < characteristics.length; ++characteristicIndex) {
        if (characteristics[characteristicIndex].uuid == '2a9d') {
          break;
        }
      }
      if (characteristicIndex >= characteristics.length) {
          console.log('  No weight measurement characteristic found.');
          peripheral.disconnect();
          return;
      }

      characteristics[characteristicIndex].on('read', function(data, isNotification) {
        // we're here when the weight is read.
        parseBleWeight(data);

        peripheral.disconnect();
      });

      characteristics[characteristicIndex].on('write', function() {

        peripheral.disconnect();
      });

      characteristics[characteristicIndex].on('broadcast', function(state) {

        peripheral.disconnect();
      });

      characteristics[characteristicIndex].on('notify', function(state) {
        characteristics[characteristicIndex].read();

      });

      characteristics[characteristicIndex].on('descriptorsDiscover', function(descriptors) {
        console.log('on -> descriptors discover ' + descriptors);

        var descriptorIndex = 0;

        descriptors[descriptorIndex].on('valueRead', function(data) {
          console.log('on -> descriptor value read ' + data);
          console.log(data);
          peripheral.disconnect();
        });

        descriptors[descriptorIndex].on('valueWrite', function() {
          console.log('on -> descriptor value write ');
          peripheral.disconnect();
        });

        descriptors[descriptorIndex].readValue();
        //descriptors[descriptorIndex].writeValue(new Buffer([0]));
      });


      characteristics[characteristicIndex].notify(true);
    });

    
    // Now that we've found the scale's Weight service, find the next level.
    services[serviceIndex].discoverIncludedServices();
  });

  // A BLE device has been discovered.  If it's the one we're looking for, connect to it.

  var localName = peripheral.advertisement.localName;

  if (properties.bleLocalName == localName) {
    console.log('Found device named ' + localName);
    noble.stopScanning();
    peripheral.connect();
  } else {
    //console.log('ignoring BLE device ' + localName + '. Continuing to scan');
  }
});

