#!/bin/bash
# Launch the app on the booted simulator at each tab and save screenshots.
set -e
APP=ae.sheen.nutrisnap
mkdir -p shots
shot() { # tab name appearance
  xcrun simctl ui booted appearance "$3"
  xcrun simctl terminate booted $APP 2>/dev/null || true
  xcrun simctl launch booted $APP -apiKey dev -devUserId demo -apiBaseURL http://localhost:3999 -initialTab "$1" -screenshotMode YES
  sleep 9
  xcrun simctl io booted screenshot "shots/$2-$3.png"
}
for a in light dark; do shot 0 today $a; shot 1 progress $a; shot 2 log $a; shot 3 plan $a; done
xcrun simctl terminate booted $APP || true
xcrun simctl launch booted $APP -apiKey "" -accessToken "" -initialTab 0
sleep 6; xcrun simctl ui booted appearance light; sleep 2; xcrun simctl io booted screenshot shots/auth-light.png
ls -la shots
