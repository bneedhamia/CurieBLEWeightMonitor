/*
 * scalegateway: a Node.js Raspberry Pi gateway that transfers
 * measurements from the Curie BLE Weight scale to the cloud.
 * See https://github.com/bneedhamia/CurieBLEWeightMonitor
 *
 * To test-run:
 *  Create a stream on http://data.sparkfun.com.
 *  cp scalegateway.cfg ~
 *  Edit ~/scalegateway.cfg, adding the private and public keys for your stream.
 *  node --use_strict scalegateway.js
 * To install as a service so it starts on boot:
 *  Do a test-run (see above) to verify that it works.
 *  ./install
 *  reboot (or just say sudo systemctl start scalegateway.service)
 *
 * Useful commands:
 *  sudo systemctl stop scalegateway.service
 *  sudo systemctl disable scalegateway.service (that will prevent it from starting on boot)
 *  sudo systemctl enable scalegateway.service (undoes the disable)
 *  sudo systemctl status scalegateway.service (to see whether it's running
 *  grep scalegateway /var/log/syslog (to find output from scalegateway.service)
 * 
 *
 * Copyright (c) 2016 Bradford Needham, North Plains, Oregon, USA
 * @bneedhamia, https://www.needhamia.com
 * Licensed under the GPL 2, a copy of which
 * should have been included with this software.
 */

/*
 * Requires Node.js version > 4.0.0 and a reasonable recent noble library.
 * See piconfig.txt for setup instructions for Raspberry Pi
 */
var os = require('os');		
var path = require('path');
var fs = require('fs');
var util = require('util');
var https = require('https');
var noble = require('noble');	// npm install noble  (see https://github.com/sandeepmistry/noble)

/*
 * CONFIG_FILENAME = the $HOME relative local file containing our configuration. See startReadingAppConfig().
 */
const CONFIG_FILENAME = 'scalegateway.cfg';

/*
 * WEIGHT_SERVICE_UUID = standard BLE Service UUID for a weight scale service.
 * WEIGHT_MEASUREMENT_GATT_UUID = standard BLE Characteristic UUID for a weight measurement.
 */
const WEIGHT_SERVICE_UUID = '181d';
const WEIGHT_MEASUREMENT_GATT_UUID = '2a9d';

/* 
 * MIN_SPARKFUN_UPLOAD_SECS = the Sparkfun-set lower limit (seconds) per upload.
 * See http://phant.io/docs/input/limit/
 */
const MIN_SPARKFUN_UPLOAD_SECS = 9;

/*
 * USER_* - BLE "User" Ids for the scale's reported weights.
 * The scale reports the measured weight as the weight of 5 'users'.
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

var properties;		// app configuration, read from CONFIG_FILENAME

/*
 * The current state of our BLE (Bluetooth Low Energy) communications.
 */
var bleState = {
  scanning: false,	// if true, scanning is on (and must be stopped before exiting).
  peripheral: null,	// the connected or connecting BLE peripheral object.
  connected: false,	// if true, we're connected to the device (and should disconnect before exiting).
  gatt: null,		// the BLE Characteristic (gatt) that we're subscribed to.
  subscribed: false,	// if true, we're subscribed to data changes (and should unsubscribe before exiting).
  weights: []		// indexed by USER_*, non-null if we've read that user's weight.
};

/*
 * A very simplistic console-logging set of functions.
 */
var logger = {
  error: function(text) {
    logger.common('ERROR', text);
  },
  warn: function(text) {
    logger.common('WARN', text);
  },
  info: function(text) {
    logger.common('INFO', text);
  },
  debug: function(text) {
    logger.common('DEBUG', text);
  },
  moduleName: null,	// the name of this JavaScript module.
 
  /*
   * The internal log function called by logger.info(), logger.debug(), etc.
   */
  common: function(severity, text) {
    // console.log('[' + (new Date()).toISOString() + '] [' + severity + '] ' + logger.moduleName + ' - ' + text);
    // the logger below is for when we run as a service: time and module are provided by syslog
    console.log(severity + ' ' + text);
  }
};

/*
 * This function is the beginning of the application control flow.
 * Called when the BLE adapter becomes available or unavailable.
 */
noble.on('stateChange', function(state) {
  if (state === 'poweredOn') {
    initialize();	// set up our program
  } else {
    logger.error('BLE adapter turned off unexpectedly. Exiting.');
    process.exit(1);
  }
});

/*
 * Initializes our application.
 * Sets up all the application-global things.
 */
function initialize() {

  // Set up console logging
  logger.moduleName = __filename.substring(__filename.lastIndexOf(path.sep) + 1);

  startReadingAppConfig();
}

/*
 * Reads our application's configuration from a local file.
 * Sets the variable "properties".
 * On error, exits.
 *
 * That file should be a JSON file with the following names:
 *   bleLocalName String. Advertised LocalName of the BLE weight scale to read from.
 *   publicKey String. The public key of the data.sparkfun.com stream to upload to.
 *   privateKey String. The private key of the data.sparkfun.com stream to upload to.
 *     Keep this secret, to prevent unauthorized apps from uploading to your stream.
 *   uploadSecs Number. The time (seconds) per upload to your data.sparkfun.com stream.
 *     That is, how often to upload weights.
 */
function startReadingAppConfig() {
  var fName = os.homedir() + path.sep + CONFIG_FILENAME;
  fs.readFile(fName, 'utf8', function(err, data) {
    if (err) {
      logger.error('Failed to read config file, ' + fName + ': ' + err);
      process.exit(1);
    }
  
    properties = JSON.parse(data);

    // Check that the necessary properties are there.

    logger.info('Application Properties');
    if (!properties.bleLocalName || properties.bleLocalName.length == 0) {
      logger.error('Missing or blank bleLocalName in ' + fName);
      process.exit(1);
    }
    logger.info('  LocalName: ' + properties.bleLocalName);

    if (!properties.publicKey || properties.publicKey.length == 0) {
      logger.error('Missing or blank publicKey in ' + fName);
      process.exit(1);
    }
    logger.info('  publicKey: ' + properties.publicKey);

    if (!properties.privateKey || properties.privateKey.length == 0) {
      logger.error('Missing or blank privateKey in ' + fName);
      process.exit(1);
    }
    logger.info('  privateKey: ' + '<elided>');

    if (!properties.uploadSecs || !Number.isInteger(properties.uploadSecs)
        || properties.uploadSecs < MIN_SPARKFUN_UPLOAD_SECS) {
      logger.error('Missing or out-of-range uploadSecs in ' + fName + '. uploadSecs: ' + properties.uploadSecs);
      process.exit(1);
    }
    logger.info('  uploadSecs: ' + properties.uploadSecs);

    /*
     * Now that our configuration is all set up, start the periodic scale reading
     * and set up to do that periodically.
     */
    startScaleRead();
    setInterval(startScaleRead, 1000 * properties.uploadSecs); // setInterval() wants milliseconds

  });
};

/*
 * If the previous scan is completed, starts a new scan
 * that should result in an upload of the next set f weights.
 */
function startScaleRead() {

  logger.debug(util.inspect(process.memoryUsage())); // to look for memory leaks. Heap use should not grow without bound.

  if (bleState.scanning) {
    logger.debug('Continuing existing scan.');
  } else if (bleState.connected || bleState.subscribed) {
    logger.debug('Skipping scan: previous scan is still busy. Connected: ' + bleState.connected
      + ', Subscribed: ' + bleState.subscribed + '.');
  } else {
    logger.debug('Scanning started.');

    bleState.scanning = true;
    noble.startScanning();	// noble.on('discover'...) should happen next.
  }

};

/*
 * Called when BLE Scanning discovers a BLE device (from that device's BLE advertising)
 */
noble.on('discover', function(peripheral) {
  var localName = peripheral.advertisement.localName;

  // A BLE device has been discovered.  If it's the one we're looking for, connect to it.
  if (properties.bleLocalName != localName) {
    logger.info('ignoring BLE device ' + localName + '. Continuing to scan');
    return; // skip this uninteresting device.
  }

  logger.info('Found ' + localName);

  // Don't scan for more devices while processing this one.
  noble.stopScanning();
  bleState.scanning = false;

  // remember the peripheral for further processing
  bleState.peripheral = peripheral;

  /*
   * Connect to the device and find its services and characteristics.
   */
  bleState.peripheral.connect(onConnect);
});

/*
 * Called when Connection to a BLE Peripheral has happened
 */
function onConnect(err) {
    if (err) {
      logger.info('connected error = ' + err);
      return;
    }
    logger.debug('Connected');
    bleState.connected = true;

    // Search for the Service we want.
    var svcUuids = [];
    svcUuids[0] = WEIGHT_SERVICE_UUID
    bleState.peripheral.discoverServices(svcUuids, onServicesDiscovered);
}

/*
 * Called when peripheral.discoverServices() completes.
 */
function onServicesDiscovered(err, services) {
  var service;  // our service of interest

  if (err) {
    logger.error('DiscoverServices failed: ' + err);
    bleState.peripheral.disconnect(function(err) {
      bleState.connected = false;
      bleState.peripheral = null;
      process.exit(1);
    });
    return; // to wait for the disconnect to complete
  }
  if (services.length != 1) {
    logger.error('DiscoverServices returned unexpected ' + services.length + ' Services');
    bleState.peripheral.disconnect(function(err) {
      bleState.connected = false;
      bleState.peripheral = null;
      process.exit(1);
    });
    return; // to wait for the disconnect to complete
  }

  service = services[0];

  // Search for the characteristic we want.
  var gattUuids = [];
  gattUuids[0] = WEIGHT_MEASUREMENT_GATT_UUID;
  service.discoverCharacteristics(gattUuids, onCharacteristicsDiscovered);
}

/*
 * Called when service.discoverCharacteristics() has completed.
 */
function onCharacteristicsDiscovered(err, gatts) {
  var i;

  if (err) {
    logger.error('DiscoverCharacteristics failed: ' + err);
    bleState.peripheral.disconnect(function(err) {
      bleState.connected = false;
      bleState.peripheral = null;
      process.exit(1);
    });
    return; // to wait for the disconnect to complete
  }
  if (gatts.length != 1) {
    logger.error('DiscoverCharacteristics returned unexpected ' + gatts.length + ' Characteristics');
    bleState.peripheral.disconnect(function(err) {
      bleState.connected = false;
      bleState.peripheral = null;
      process.exit(1);
    });
    return; // to wait for the disconnect to complete
  }

  bleState.gatt = gatts[0];

  // NOTE: each .on() call adds another listener to this gatt.  We must remove it when done.
  bleState.gatt.on('data', onData);

  // Now that our callbacks is set up, turn on notification of new values.
  for (i = 0; i < NUM_USERS; ++i) {
    bleState.weights[i] = null;
  }
  bleState.subscribe = true;
  bleState.gatt.subscribe();	// triggers 'data' event on notification
}

/*
 * Called when new Weight Measurement is ready,
 * reads and interprets that Weight Measurement value.
 */
function onData(data, isNotify) {
  var userWeight;	// userId and weight, returned by parseBleWeight()

  userWeight = parseBleWeight(data);
  //logger.info('User ' + userWeight.userId + ': ' + userWeight.weightKg + ' kg');

  /*
   * Weights are reported in order: USER_TOTAL first, then the others.
   * We want a consistent set of weights,
   * starting with USER_TOTAL and ending with NUM_USERS - 1.
   */
  if (userWeight.userId >= NUM_USERS) {
    return;	// skip USER_RESET because it's a temporary state.
  }
  if (userWeight.userId != USER_TOTAL && !bleState.weights[USER_TOTAL]) {
    return;	// skip reports until the start of a set.
  }

  bleState.weights[userWeight.userId] = userWeight.weightKg;

  if (userWeight.userId == NUM_USERS - 1) {
    // We've read a set of weights. 

    // Close up all the BLE things.
    bleState.gatt.removeListener('data', onData);	// removes our listener, so we don't create more and more
    bleState.gatt.unsubscribe(onGattUnsubscription);
    bleState.gatt = null;
  }
}

/*
 * Called when gatt.unsubscribe() completes.
 */
function onGattUnsubscription(err) {
  bleState.subscribe = false;
  if (err) {
    logger.error('Failed to unsubscribe: ' + err);
    // go on - what else can we do?
  }
  bleState.peripheral.disconnect(onNormalPeripheralDisconnected);
};

/*
 * Called on the normal disconnection
 * that happens when we've successfully read one complete set of weights
 */
function onNormalPeripheralDisconnected(err) {
  var streamKeys;
  var record;

  bleState.connected = false;
  bleState.peripheral = null;
  if (err) {
    logger.error('Failed to disconnect: ' + err);
    // ignore the error.
  }
  
  // Upload the record to Sparkfun.

  streamKeys = {
    'privateKey': properties.privateKey,
    'publicKey': properties.publicKey
  };

  record = {
    'total_kg': bleState.weights[USER_TOTAL],
    'ul_kg': bleState.weights[USER_UL],
    'ur_kg': bleState.weights[USER_UR],
    'll_kg': bleState.weights[USER_LL],
    'lr_kg': bleState.weights[USER_LR]
  }; 

  startSendToSparkfun(streamKeys, record, onSparkfunUploadComplete);
}

/*
 * Called when the upload to data.sparkfun.com has completed.
 */
function onSparkfunUploadComplete(err) {
  var str = '';
  var i;

  if (err) {
    logger.error('Upload error: ' + err);
  } else {
    for (i = 0; i < NUM_USERS; ++i) {
      str = str + ' ' + bleState.weights[i];
    }
    logger.debug('Upload successful. User 0-4 weights:' + str);
  }
}
 
/*
 * Parse the standard BLE Weight Measurement characteristic.
 * param bleData = the raw bytes of the characteristic.
 * returns an object with fields 'userId' = the user, and 'weightKg' = reported weight in Kilograms.
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
  var userWeight = new Object();	// value to return
  var wFlags;		// flags for the weight encoding
  var i;

  if (bleData.length != 4) {
    logger.error('Garbled BLE Weight measurement: data length = ' + bleData.length);
    return;
  }

  // Check that the flags match our expectations
  wFlags = bleData[0];
  if ((wFlags & 0x01)) {  // we assume SI units
    logger.error('Skipping unexpected Weight Flag: scale is reporting in Imperial units instead of SI units');
    return;
  }
  if ((wFlags & 0x02)) {  // we assume no timestamp
    logger.error('Skipping unexpected Weight Flag: scale includes a timestamp');
    return;
  }
  if ((wFlags & 0x04) == 0) {  // we assume a user id
    logger.error("Skipping unexpected Weight Flag: scale doesn't report user ID");
    return;
  }
  if ((wFlags & 0x08)) {  // we assume no BMI or Height
    logger.error('Skipping unexpected Weight Flag: scale includes BMI and Height');
    return;
  }

  // Assemble the weight, scaled by the standard BLE value.
  userWeight.weightKg = (bleData[2] << 8) + bleData[1];
  userWeight.weightKg = (userWeight.weightKg * 5.0) / 1000.0;

  userWeight.userId = bleData[3];

  return userWeight;
}

/*
 * Starts sending the given record to the appropriate stream on data.sparkfun.com
 * streamInfo = an object describing the Stream to send to, containing:
 *   publicKey String. The Sparkfun public key of the stream.
 *   privateKey String. The Sparkfun private key (posting key) of the stream.
 * record = an object describing the data to send, containing one property and value
 *   for each field in the record.
 *   The property name and value must NOT be urlEncoded.
 * onCompletion = a function(error) called when the transfer is complete, where
 *   error = null for success; on error contains explanatory text.
 */
function startSendToSparkfun(streamInfo, record, onCompletion) {
  var path;
  var name;
  var options;	// https request options.
  var isFirst;

  if (!streamInfo.publicKey || streamInfo.publicKey.length == 0) {
    if (onCompletion) {
      onCompletion('Missing or empty publicKey field in streamInfo');
    }
    return;
  }
  if (!streamInfo.privateKey || streamInfo.privateKey.length == 0) {
    if (onCompletion) {
      onCompletion('Missing or empty privateKey field in streamInfo');
    }
    return;
  }

  // assemble the path and parameters
  path = '/input/' + streamInfo.publicKey + '?';
  isFirst = true;
  for (name in record) {
    if (!isFirst) {
      path = path + '&';
    }
    isFirst = false;

    path = path + encodeURIComponent(name) + '=' + encodeURIComponent(record[name]);
  }

  //logger.debug('path: ' + path);

  options = {
    'hostname': 'data.sparkfun.com',
    'port': 443,
    'path': path,
    'method': 'POST',
    'headers': {
      'Phant-Private-Key': streamInfo.privateKey 
    }
  }

  doHttpsRequest(options, onCompletion);
}

/*
 * Performs an https request, ignoring the resultng data.
 * options = https.request() options.
 * onCompletion(err) = a function to call on completion.
 *  err = if non-null, the text of the error.  If err == null, transfer was successful.
 */
function doHttpsRequest(options, onCompletion) {
  var req;

  req = https.request(options, function(res) {
    res.setEncoding('utf8');
  
    res.on('data', function(d) {
      if (res.statusCode > 299) {
        if (onCompletion) {
          onCompletion('HTTP code ' + res.statusCode + ': ' + d);
        }
      } else {
        // Successful transfer.
        if (onCompletion) {
          onCompletion(null); // success
        }
      }
    });
    
  });

  req.on('error', function(err) {
    if (onCompletion) {
      onCompletion('https transfer error: ' + err);
    }
  });

  // Sparkfun docs say to put the values in the body, but it seemed to work only with values in the path.
  req.end();
}
