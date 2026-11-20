#!/bin/bash
# Sample data for simulator screenshots (local backend, AUTH_MODE=dev).
set -e
B=http://localhost:3999; U=demo
c() { curl -sf -H "X-User-Id: $U" -H "Content-Type: application/json" "$@" > /dev/null; }
d() { TZ=Asia/Dubai date -v-"$1"d +%F; }
c -X PUT $B/profile -d '{"sex":"female","birthYear":1998,"heightCm":165,"activityLevel":"light","goal":"lose","targetWeightKg":75,"pace":"moderate","onboarded":true,"timezone":"Asia/Dubai"}'
w=90.5
for i in 20 18 16 14 12 10 8 6 4 2 1 0; do w=$(echo "$w - 0.$((RANDOM % 4 + 1))" | bc); c -X POST $B/weights -d "{\"kg\":$w,\"date\":\"$(d $i)\"}"; done
meal() { # name_ar restaurant kcal protein carbs fat fiber daysAgo hour
  T="$(d $8)T$9:00:00+04:00"
  ID=$(curl -sf -H "X-User-Id: $U" -H "Content-Type: application/json" -X POST $B/meals -d "{\"meal_name\":\"$1\",\"meal_name_ar\":\"$1\",\"restaurant\":$2,\"source\":\"restaurant_published\",\"confidence\":0.9,\"eatenAt\":\"$T\",\"items\":[{\"name\":\"$1\",\"name_ar\":\"$1\",\"quantity\":1,\"unit\":\"serving\",\"calories\":$3,\"protein_g\":$4,\"carbs_g\":$5,\"fat_g\":$6,\"fiber_g\":$7,\"sugar_g\":5,\"sodium_mg\":600}]}" | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
  c -X POST $B/meals/$ID/confirm
}
for i in 6 5 4 3 2 1; do
  meal "شوفان باللبن والتوت" null 380 22 52 9 7 $i 08
  meal "شاورما دجاج عربي" '"Operation Falafel"' $((620 + RANDOM % 300)) 34 60 24 4 $i 13
  meal "سلمون مشوي مع خضار" null 520 42 20 28 6 $i 19
done
meal "شوفان باللبن والتوت" null 380 22 52 9 7 0 08
meal "بولو سلطة دجاج" '"Salad Stop"' 460 38 30 18 8 0 13
c -X POST $B/energy/samples -d "{\"samples\":[{\"date\":\"$(d 0)\",\"source\":\"whoop\",\"activeKcal\":520,\"basalKcal\":1480},{\"date\":\"$(d 1)\",\"source\":\"whoop\",\"activeKcal\":610,\"basalKcal\":1480}]}"
c -X POST $B/workouts -d "{\"source\":\"manual\",\"workouts\":[{\"externalId\":\"w1\",\"sport\":\"functional-fitness\",\"start\":\"$(d 0)T03:30:00Z\",\"end\":\"$(d 0)T04:25:00Z\",\"kcal\":410,\"avgHr\":138},{\"externalId\":\"w2\",\"sport\":\"walking\",\"start\":\"$(d 0)T14:00:00Z\",\"end\":\"$(d 0)T14:35:00Z\",\"kcal\":160,\"avgHr\":104,\"distanceM\":3100}]}"
echo seeded
