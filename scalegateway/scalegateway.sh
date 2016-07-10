#!/bin/sh
#OBSOLETE. This was an attempt to use /etc/init.d,
#which has been obsoleted by systemd

# Raspbian /etc/init.d/ script to run scalegateway as a service.

### BEGIN INIT INFO
# Provides:        scalegatewayd
# Required-Start:  $network $remote_fs $syslog
# Required-Stop:   $network $remote_fs $syslog
# Default-Start:   2 3 4 5
# Default-Stop:    0 1 6
# Short-Description: Start scalegateway daemon
# Description:		Starts the Dog Bed Weight Scale uploader on boot.
# 					The uploader transfers BLE (Bluetooth Low Energy)
#					weight data from the dog bed to
#					the data.sparkfun.com Data Warehouse.
#					See https://github.com/bneedhamia/CurieBLEWeightMonitor
### END INIT INFO

PATH=/sbin:/bin:/usr/sbin:/usr/bin
. /lib/lsb/init-functions

DAEMON=/home/pi/Documents/CurieBLEWeightMonitor/scalegateway/scalegatewayd
PIDFILE=/var/run/scalegatewayd.pid

RUNASUSER=pi		# Run as user pi because scalegateway.js gets options from ~
HOME=/home/$RUNASUSER
UGID=$(getent passwd $RUNASUSER | cut -f 3,4 -d:) || true

case $1 in
	start)
		log_daemon_msg "Starting scalegateway server" "scalegatewayd"
		if [ -z "$UGID" ]; then
			log_failure_msg "user \"$RUNASUSER\" does not exist"
			exit 1
		fi
  		start-stop-daemon --start --quiet --oknodo --pidfile $PIDFILE --startas $DAEMON -- -p $PIDFILE -u $UGID -d `dirname $DAEMON` -b
		status=$?
		log_end_msg $status
  		;;
	stop)
		log_daemon_msg "Stopping scalegateway server" "scalegatewayd"
  		start-stop-daemon --stop --quiet --oknodo --pidfile $PIDFILE
		log_end_msg $?
		rm -f $PIDFILE
  		;;
	restart|force-reload)
		$0 stop && sleep 2 && $0 start
  		;;
	try-restart)
		if $0 status >/dev/null; then
			$0 restart
		else
			exit 0
		fi
		;;
	reload)
		exit 3
		;;
	status)
		status_of_proc $DAEMON "scalegateway server"
		;;
	*)
		echo "Usage: $0 {start|stop|restart|try-restart|force-reload|status}"
		exit 2
		;;
esac
