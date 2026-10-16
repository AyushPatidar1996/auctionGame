# players.v1.json — review notes

Draft written by Claude from general cricket knowledge, 2026-10-16. All scores,
tiers and tags are **judgement, not data**. Ids are `p<rank>` from
`players-shortlist.md`, so `p001` = rank 1.

## Calibration used
- Scores are 0–100. Elite ≈ 90+, good starter ≈ 75–89, squad player ≈ 55–74, marginal < 55.
- A skill score of 20 or less means "doesn't really do this", and the matching type
  (`batType` / `bowlType`) is null. Validator-enforced in the build.
- `fieldScore` and `brandAppeal` for tier C players are rough defaults. Brand tracks
  fame, so low values there mean "unknown", not "bad".
- Keepers: only players who regularly keep in T20s are marked `isKeeper`.

## Distribution (differs from the 10 / 50 / 100 / 140 plan)
| Tier | Count |
| --- | --- |
| marquee | 10 |
| A | 35 |
| B | 63 |
| C | 192 |

The tail of 300 is mostly low-profile players, so C is large. Promote or demote
by hand. Remember `tierBasePrice` and lot order both key off this.

## Rows I am least sure about (check or overwrite first)
My knowledge of the 2025–26 intake is thin. These are guesses from a surname and
initials, or from very little data. Check name, nationality, role and bowling type:

- Identity unclear: p185 Praful Hinge, p194 Kartik Sharma, p195 Shivang Kumar,
  p234 SR Dubey, p237 S Arora, p238 M Tiwari, p269 SU Parakh, p270 Salil Arora,
  p274 Akshat Raghuwanshi, p276 AA Kulkarni, p281 Ramakrishna Ghosh,
  p291 Sumit Kumar, p292 Saurav Chauhan, p296 Tejasvi Dahiya, p297 Krish Bhagat,
  p299 Ricky Bhui
- Role / bowling type guessed: p156 Vipraj Nigam, p158 Prince Yadav, p159 Digvesh Rathi,
  p168 Ashwani Kumar, p179 Sakib Hussain, p186 Brijesh Sharma, p191 Harsh Dubey,
  p192 Akash Singh, p208 Manimaran Siddharth, p210 Yash Raj Punja, p212 Jacob Duffy,
  p214 Shubham Dubey, p223 Mukul Choudhary, p224 Suryansh Shedge, p227 Ashok Sharma,
  p228 Zeeshan Ansari, p248 Prashant Veer, p252 Abhinandan Singh, p263 Sushant Mishra,
  p275 PVSN Raju, p279 Raghu Sharma, p280 Sanvir Singh, p290 R Smaran, p163 Ayush Mhatre
- Known players where a tag is debatable: p38 Abhishek Sharma (part-time left-arm spin),
  p77 Travis Head (part-time off-spin), p231 Kamindu Mendis (bowls both arms; tagged
  off-spin right-arm), p34 Varun Chakravarthy (tagged leg spin), p113 Devon Conway and
  p188 Finn Allen (keeping status varies by team).

## Known simplifications
- `bowlPhases` is one or two phases per bowler and reflects typical usage, not a stat.
- `nationality` is the country represented. Tim David is listed as Australia.
- Display name is the full common name unless a short scorecard form is the usual use
  (for example `R Ashwin`).
