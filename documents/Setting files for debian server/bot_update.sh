#!/bin/bash

FOLDERS="$(ls -d */)"
CURRENT_FOLDER="$(pwd)"
for folder in ${FOLDERS};do
	BOT_PATH="${CURRENT_FOLDER}/${folder}"
	S_NAME="${folder%?}"".service"
	cd ${BOT_PATH}
	echo ${BOT_PATH}
	eval "systemctl stop ""${S_NAME}" #stop bot
	git pull
	yarn
	yarn compile
	eval "systemctl restart ""${S_NAME}" #restart bot
done