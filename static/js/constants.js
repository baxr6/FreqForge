const GRADE_COLOR = {"A+":"var(--green)","A":"var(--green)","A-":"var(--green)",
  "B+":"var(--green)","B":"var(--green)","B-":"var(--green)",
  "C+":"var(--amber)","C":"var(--amber)","C-":"var(--amber)",
  "D+":"var(--red)","D":"var(--red)","D-":"var(--red)","F":"var(--red)"};
const GRADE_GLOW = {"A+":"var(--green-glow)","A":"var(--green-glow)","A-":"var(--green-glow)",
  "B+":"var(--green-glow)","B":"var(--green-glow)","B-":"var(--green-glow)",
  "C+":"var(--amber-glow)","C":"var(--amber-glow)","C-":"var(--amber-glow)",
  "D+":"var(--red-glow)","D":"var(--red-glow)","D-":"var(--red-glow)","F":"var(--red-glow)"};

function bandOf(grade){ return grade[0]; }

function letterGrade(score){
  if(score>=90) return "A+";
  if(score>=85) return "A";
  if(score>=80) return "A-";
  if(score>=75) return "B+";
  if(score>=70) return "B";
  if(score>=65) return "B-";
  if(score>=60) return "C+";
  if(score>=55) return "C";
  if(score>=50) return "C-";
  if(score>=45) return "D+";
  if(score>=40) return "D";
  if(score>=35) return "D-";
  return "F";
}

let RUNS = {};     // lev -> raw metrics
let DATA = {};     // lev -> raw + computed scores/grade
let ORDER = [];
let currentLev = null;

/* ============ STORAGE (real backend — SQLite via Flask API) ============ */
