import Adw from "gi://Adw";
import Gtk from "gi://Gtk";
import Gio from "gi://Gio";
import GObject from "gi://GObject";

// How to do this in production?
const status = workbench.builder.get_object("status");
const logbox = workbench.builder.get_object("logbox");
const startbutton = workbench.builder.get_object("startbutton");

// Set what happens when startbutton is clicked
startbutton.connect("clicked", () => {
  startstop();
});
const projectlist = workbench.builder.get_object("projectlist");

// Set what happens when projectlist is selected
projectlist.connect("notify::selected-item", () => {
  const selection = projectlist.selected_item;
  if (selection) {
    console.log(selection.value);
  }
});

const project = GObject.registerClass(
  {
    Properties: {
      value: GObject.ParamSpec.string(
        "value",
        null,
        null,
        GObject.ParamFlags.READWRITE,
        "",
      ),
    },
  },
  class project extends GObject.Object {},
);

// The projects are added to the projectlist item
const model = new Gio.ListStore({ item_type: project });
model.splice(0, 0, [
  new project({ value: "(no project)" }),
  new project({ value: "Kevin" }),
]);
const listexpression = Gtk.PropertyExpression.new(project, null, "value");
projectlist.expression = listexpression;
projectlist.model = model;

// Set the global variables
var logging = false;
var theLog = "";
var timer = setInterval(setTimerText, 1000);
clearInterval(timer);
var startedTime = new Date();

async function startstop() {
  const currentDate = new Date();

  const selection = projectlist.selected_item;

  const value = selection.value;
  const selectionText = value;

  if (logging) {
    logging = false;
    startbutton.label = "Start";
    writeout(currentDate, "Stopped", selectionText.toString());
    stopTimer();
  } else {
    logging = true;
    startbutton.label = "Stop";
    writeout(currentDate, "Started", selectionText.toString());
    startedTime = currentDate;
    startTimer();
  }
}

async function writeout(currentDate, status, project) {
  const TexttoWrite =
    status + " " + project + " " + timeToOutputFormat(currentDate);
  theLog += TexttoWrite + "\n";
  logbox.label = theLog;
  console.log(TexttoWrite);
}

async function startTimer() {
  setTimerText();
  timer = setInterval(setTimerText, 1000);
}

async function stopTimer() {
  clearInterval(timer);
  setTimerText();
}

async function setTimerText() {
  if (logging) {
    const currentDate = new Date();
    status.label = "Time: " + calcTimeDifference(startedTime, currentDate);
  } else {
    status.label = "Time: stopped";
  }
}

async function alert(toShow) {
  const dialog = new Adw.AlertDialog({
    body: toShow,
  });
  dialog.add_response("ok", "OK");
  const response = await dialog.choose(workbench.window, null);
  return response;
}

function calcTimeDifference(startTime, endTime, textOutput = true) {
  const timeDifference = endTime - startTime; // Time difference in milliseconds
  if (textOutput == false) {
    return timeDifference;
  } else {
    const hours = Math.floor(timeDifference / (1000 * 60 * 60));
    const minutes = Math.floor(
      (timeDifference % (1000 * 60 * 60)) / (1000 * 60),
    );
    const seconds = Math.floor((timeDifference % (1000 * 60)) / 1000);
    return `${hours}h ${minutes}m ${seconds}s`;
  }
}

function timeToOutputFormat(time) {
  const day = time.getDay();
  const month = time.getMonth();
  const year = time.getFullYear();
  const hours = time.getHours();
  const minutes = time.getMinutes();
  const seconds = time.getSeconds();
  if (minutes.length === 1) {
    minutes = "0" + minutes;
  }
  if (seconds.length === 1) {
    seconds = "0" + seconds;
  }
  return `${month}/${day}/${year} ${hours}:${minutes}:${seconds}`;
}

function outputFormatToTime(time) {}
