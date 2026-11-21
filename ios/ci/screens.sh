#!/bin/bash
# Launch the app on the booted simulator at each tab and save screenshots (English + Arabic).
set -e
APP=ae.sheen.nutrisnap
mkdir -p shots
shot() { # tab name appearance lang
  xcrun simctl ui booted appearance "$3"
  xcrun simctl terminate booted $APP 2>/dev/null || true
  xcrun simctl launch booted $APP -apiKey dev -devUserId demo -apiBaseURL http://localhost:3999 -initialTab "$1" -screenshotMode YES -appLanguage "$4"
  sleep 9
  xcrun simctl io booted screenshot "shots/$2-$4-$3.png"
}
for v in "light en" "dark en" "light ar"; do set -- $v; a=$1; l=$2
  shot 0 today $a $l; shot 1 progress $a $l; shot 2 log $a $l; shot 3 plan $a $l
done
xcrun simctl terminate booted $APP || true
xcrun simctl launch booted $APP -apiKey "" -accessToken "" -initialTab 0 -appLanguage en
sleep 6; xcrun simctl ui booted appearance light; sleep 2; xcrun simctl io booted screenshot shots/auth-en-light.png
ls -la shots
