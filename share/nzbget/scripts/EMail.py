#!/usr/bin/env python
#
# E-Mail post-processing script for NZBGet
#
# Copyright (C) 2013-2014 Andrey Prygunkov <hugbug@users.sourceforge.net>
#
# This program is free software; you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation; either version 2 of the License, or
# (at your option) any later version.
# 
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.
# 
# You should have received a copy of the GNU General Public License
# along with this program; if not, write to the Free Software
# Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA.
#
# $Revision: 1031 $
# $Date: 2014-05-29 00:19:39 +0200 (Thu, 29 May 2014) $
#


##############################################################################
### NZBGET POST-PROCESSING SCRIPT                                          ###

# Send E-Mail notification.
#
# This script sends E-Mail notification when the job is done.
#
# NOTE: This script requires Python to be installed on your system.

##############################################################################
### OPTIONS                                                       ###

# Email address you want this email to be sent from. 
#From="NZBGet" <myaccount@gmail.com>

# Email address you want this email to be sent to. 
#To=myaccount@gmail.com

# SMTP server host.
#Server=smtp.gmail.com

# SMTP server port (1-65535).
#Port=25

# Secure communication using TLS/SSL (yes, no).
#Encryption=yes

# SMTP server user name, if required.
#Username=myaccount

# SMTP server password, if required.
#Password=mypass

# Append list of files to the message (yes, no).
#
# Add the list of downloaded files (the content of destination directory).
#FileList=yes

# Append broken-log to the message (yes, no).
#
# Add the content of file _brokenlog.txt. This file contains the list of damaged
# files and the result of par-check/repair. For successful downloads the broken-log
# is usually deleted by cleanup-script and therefore is not sent.
#BrokenLog=yes

# Append post-processing log to the message (Always, Never, OnFailure).
#
# Add the post-processing log of active job.
#PostProcessLog=OnFailure

### NZBGET POST-PROCESSING SCRIPT                                          ###
##############################################################################


import os
import sys
import datetime
import smtplib
from email.mime.text import MIMEText
try:
	from xmlrpclib import ServerProxy # python 2
except ImportError:
	from xmlrpc.client import ServerProxy # python 3

# Exit codes used by NZBGet
POSTPROCESS_SUCCESS=93
POSTPROCESS_ERROR=94

# Check if the script is called from nzbget 11.0 or later
if not 'NZBOP_SCRIPTDIR' in os.environ:
	print('*** NZBGet post-processing script ***')
	print('This script is supposed to be called from nzbget (11.0 or later).')
	sys.exit(POSTPROCESS_ERROR)

print('[DETAIL] Script successfully started')
sys.stdout.flush()

required_options = ('NZBPO_FROM', 'NZBPO_TO', 'NZBPO_SERVER', 'NZBPO_PORT', 'NZBPO_ENCRYPTION',
	'NZBPO_USERNAME', 'NZBPO_PASSWORD', 'NZBPO_FILELIST', 'NZBPO_BROKENLOG', 'NZBPO_POSTPROCESSLOG')
for	optname in required_options:
	if (not optname in os.environ):
		print('[ERROR] Option %s is missing in configuration file. Please check script settings' % optname[6:])
		sys.exit(POSTPROCESS_ERROR)
		
success = os.environ['NZBPP_TOTALSTATUS'] == 'SUCCESS'
if success:
	subject = 'Success for "%s"' % (os.environ['NZBPP_NZBNAME'])
	text = 'Download of "%s" has successfully completed.' % (os.environ['NZBPP_NZBNAME'])
else:
	subject = 'Failure for "%s"' % (os.environ['NZBPP_NZBNAME'])
	text = 'Download of "%s" has failed.' % (os.environ['NZBPP_NZBNAME'])

text += '\nStatus: %s' % os.environ['NZBPP_STATUS']

# add list of downloaded files
if os.environ['NZBPO_FILELIST'] == 'yes':
	text += '\n\nFiles:'
	for dirname, dirnames, filenames in os.walk(os.environ['NZBPP_DIRECTORY']):
		for filename in filenames:
			text += '\n' + os.path.join(dirname, filename)[len(os.environ['NZBPP_DIRECTORY']) + 1:]

# add _brokenlog.txt (if exists)
if os.environ['NZBPO_BROKENLOG'] == 'yes':
	brokenlog = '%s/_brokenlog.txt' % os.environ['NZBPP_DIRECTORY']
	if os.path.exists(brokenlog):
		text += '\n\nBrokenlog:\n' + open(brokenlog, 'r').read().strip()

# add post-processing log
if os.environ['NZBPO_POSTPROCESSLOG'] == 'Always' or \
	(os.environ['NZBPO_POSTPROCESSLOG'] == 'OnFailure' and not success):
	# To get the post-processing log we connect to NZBGet via XML-RPC
	# and call method "postqueue", which returns the list of post-processing job.
	# The first item in the list is current job. This item has a field 'Log',
	# containing an array of log-entries.
	# For more info visit http://nzbget.net/RPC_API_reference
	
	# First we need to know connection info: host, port and password of NZBGet server.
	# NZBGet passes all configuration options to post-processing script as
	# environment variables.
	host = os.environ['NZBOP_CONTROLIP'];
	port = os.environ['NZBOP_CONTROLPORT'];
	username = os.environ['NZBOP_CONTROLUSERNAME'];
	password = os.environ['NZBOP_CONTROLPASSWORD'];
	
	if host == '0.0.0.0': host = '127.0.0.1'
	
	# Build an URL for XML-RPC requests
	rpcUrl = 'http://%s:%s@%s:%s/xmlrpc' % (username, password, host, port);
	
	# Create remote server object
	server = ServerProxy(rpcUrl)
	
	# Call remote method 'postqueue'. The only parameter tells how many log-entries to return as maximum.
	postqueue = server.postqueue(10000)
	
	# Get field 'Log' from the first post-processing job
	log = postqueue[0]['Log']
	
	# Now iterate through entries and save them to message text
	if len(log) > 0:
		text += '\n\nPost-processing log:';
		for entry in log:
			text += '\n%s\t%s\t%s' % (entry['Kind'], datetime.datetime.fromtimestamp(int(entry['Time'])), entry['Text'])

# Create message
msg = MIMEText(text)
msg['Subject'] = subject
msg['From'] = os.environ['NZBPO_FROM']
msg['To'] = os.environ['NZBPO_TO']

# Send message
print('[DETAIL] Sending E-Mail')
sys.stdout.flush()
try:
	smtp = smtplib.SMTP(os.environ['NZBPO_SERVER'], os.environ['NZBPO_PORT'])

	if os.environ['NZBPO_ENCRYPTION'] == 'yes':
		smtp.starttls()
	
	if os.environ['NZBPO_USERNAME'] != '' and os.environ['NZBPO_PASSWORD'] != '':
		smtp.login(os.environ['NZBPO_USERNAME'], os.environ['NZBPO_PASSWORD'])
	
	smtp.sendmail(os.environ['NZBPO_FROM'], os.environ['NZBPO_TO'], msg.as_string())
	
	smtp.quit()
except Exception as err:
	print('[ERROR] %s' % err)
	sys.exit(POSTPROCESS_ERROR)

# All OK, returning exit status 'POSTPROCESS_SUCCESS' (int <93>) to let NZBGet know
# that our script has successfully completed.
sys.exit(POSTPROCESS_SUCCESS)
