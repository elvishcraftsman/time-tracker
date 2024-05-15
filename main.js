// Testing opening a file
// https://gjs.guide/guides/gio/file-operations.html
// http://git.gnome.org/browse/gjs/tree/examples/gio-cat.js
/*
import GLib from "gi://GLib";
import Gio from "gi://Gio";

// This is a useful method for building file paths from GLib. It will use the
// correct path separator for the current operating system (eg. `/` or `\`)
const filepath = GLib.build_filenamev([GLib.get_home_dir(), "text-file.txt"]);

const file = Gio.File.new_for_path(filepath);

// Write
const bytes = new GLib.Bytes("some file contents");
console.log(bytes.toString());
const [etag] = await file.replace_contents_bytes_async(
  bytes,
  null,
  false,
  Gio.FileCreateFlags.REPLACE_DESTINATION,
  null,
  null,
);
/*
g_file_replace_contents_bytes_async (
  GFile* file,
  GBytes* contents,
  const char* etag,
  gboolean make_backup,
  GFileCreateFlags flags,
  GCancellable* cancellable,
  GAsyncReadyCallback callback,
  gpointer user_data
)


// Read
const [contents, etag2] = await file.load_contents_async(null);

const decoder = new TextDecoder("utf-8");
const contentsString = decoder.decode(contents);
console.log(contentsString);
*/
///////////////////////////////////////////////////////////////////////////////////////////////////////

// Imports and declaring objects

import Adw from "gi://Adw";
import Gtk from "gi://Gtk";
import Gio from "gi://Gio";
import GObject from "gi://GObject";

// How to do workbench.builder in production?
const status = workbench.builder.get_object("status");
const startbutton = workbench.builder.get_object("startbutton");
const add = workbench.builder.get_object("add");
const edit = workbench.builder.get_object("edit");
const editproject = workbench.builder.get_object("editproject");
const remove = workbench.builder.get_object("remove");
const list_box_editable = workbench.builder.get_object("list_box_editable");
const search_entry = workbench.builder.get_object("search_entry");
const projectlist = workbench.builder.get_object("projectlist");
const totallabel = workbench.builder.get_object("totallabel");
//const editentrypopup = workbench.builder.get_object("editentrypopup");
var logging = false; // Is the timer currently logging time?
//var theLog = "";
var timer = setInterval(setTimerText, 1000);
clearInterval(timer);
var startedTime = new Date();
let entries = [];
let projects = [];
let logpath = "";
let firstdayofweek = 0;
let addprojectsfromlog = true;

/////////////////////////////////////////////////////////////////////////////////////////////////////////

// Set up event handlers

// Set what happens when startbutton is clicked
startbutton.connect("clicked", () => {
  startstop();
});

// Set what happens when projectlist is selected
projectlist.connect("notify::selected-item", () => {
  const selection = projectlist.selected_item;
  if (selection && logging) {
    const value = selection.value;
    editrunningentry(value);
  }
});

/////////////////////////////////////////////////////////////////////////////////////////////////////////

// Import data into controls

// Import data into projectlist item

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

// {{{ The projects are added to the projectlist item
const model = new Gio.ListStore({ item_type: project });
const listexpression = Gtk.PropertyExpression.new(project, null, "value");
projectlist.expression = listexpression;
projectlist.model = model;

// Import data into time entry list item

// Code for list box

// {{{ Here's where the initial value is declared
const logmodel = new Gtk.StringList({
  //strings: ["Default Item 1", "Default Item 2", "Default Item 3"],
});
//let item = 1;

logmodel.connect("items-changed", (_self, position, removed, added) => {
  console.log(
    `position: ${position}, Item removed? ${Boolean(
      removed,
    )}, Item added? ${Boolean(added)}`,
  );
});

//Filter-Model
const search_expression = Gtk.PropertyExpression.new(
  Gtk.StringObject,
  null,
  "string",
);
const filter = new Gtk.StringFilter({
  expression: search_expression,
  ignore_case: true,
  match_mode: Gtk.StringFilterMatchMode.SUBSTRING,
});
const filter_model = new Gtk.FilterListModel({
  model: logmodel,
  filter: filter,
  incremental: true,
});

setprojects();
readsettings();
readlog();

async function readlog() {
  // Code tbd {{{
  // Set the entries array and the listbox contents
  // Set any extra projects, if the setting allows
}

async function writelog() {
  // Code tbd {{
}

function readsettings() {
  // For testing purposes. Here will be the code
  // that reads the settings file
  let settingstext = `log=/home/
firstdayofweek=0
addprojectsfromlog=true
projects=Work,Freelance`;

  const settings = settingstext.split("\n");

  for (let i = 0; i < settings.length; i++) {
    const setting = settings[i];
    try {
      const type = setting.split("=")[0];
      const value = setting.split("=")[1];
      if (type == "log") {
        logpath = value;
      } else if (type == "firstdayofweek") {
        firstdayofweek = parseInt(value);
      } else if (type == "projects") {
        setprojects(value.split(","));
      } else if (type == "addprojectsfromlog") {
        if (value == "false") {
          addprojectsfromlog = false;
        }
      }
    } catch (error) {
      console.log("Problem with settings file: " + error);
    }
  }
}

async function writesettings() {
  // Code tbd {{{
}

async function settingsdialog() {
  // Code tbd {{{
  writesettings();
}

function createItemForFilterModel(listItem) {
  const listRow = new Adw.ActionRow({
    title: listItem.string,
  });
  return listRow;
}

list_box_editable.bind_model(filter_model, createItemForFilterModel);

// Controller
add.connect("clicked", () => {
  editentrydialog();
});

remove.connect("clicked", () => {
  const selectedRow = list_box_editable.get_selected_row();
  const index = selectedRow.get_index();
  removeentry(index);
});

edit.connect("clicked", () => {
  const selectedRow = list_box_editable.get_selected_row();
  const index = selectedRow.get_index();
  editentrydialog(index);
});

editproject.connect("clicked", () => {
  editprojectdialog();
});

search_entry.connect("search-changed", () => {
  const searchText = search_entry.get_text();
  filter.search = searchText;
});

list_box_editable.connect("row-selected", () => {
  remove.sensitive = list_box_editable.get_selected_row() !== null;
  edit.sensitive = list_box_editable.get_selected_row() !== null;
});

/////////////////////////////////////////////////////////////////////////////////////////////////////////

// The functions

// This fires when the start/stop button is clicked, and starts all the other processes.
async function startstop() {
  const currentDate = new Date();
  const selection = projectlist.selected_item;
  const value = selection.value;
  const selectionText = value;

  if (logging) {
    logging = false;
    startbutton.label = "Start";
    stoprunningentry(currentDate);
    //writeout(currentDate, "Stopped", selectionText.toString());
    stopTimer();
    // Code fore resetting project dropdown {{{
    projectlist.set_selected(0);
  } else {
    logging = true;
    startbutton.label = "Stop";
    addentry(selectionText.toString(), currentDate);
    startedTime = currentDate;
    startTimer();
  }
}

// Add an entry
async function addentry(project, startDate, endDate = null) {
  // Add to array
  entries.push({ start: startDate, end: endDate, project: project });
  // Add to log control
  let new_item = "";
  if (endDate === null) {
    new_item = "_h _m _s | Project: " + project;
    logmodel.append(new_item);
  } else {
    new_item =
      calcTimeDifference(startDate, endDate) + " | Project: " + project;
    logmodel.append(new_item);
    updatetotals();
  }
  writelog();
}

// Remove the entry at the given index
async function removeentry(number) {
  entries.splice(number, 1);
  logmodel.remove(number);
  writelog();
  updatetotals();
}

// Stop the last entry without a stop date, and update the project
async function stoprunningentry(endDate, theproject) {
  // Find the index of the last item with a null value for "stop"
  let lastIndexWithNullEnd = -1;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].end === null) {
      lastIndexWithNullEnd = i;
      break;
    }
  }

  if (theproject == "") {
    theproject = entries[lastIndexWithNullEnd].project;
  }

  // If there's an item with null stop date, update it
  if (lastIndexWithNullEnd !== -1) {
    editentry(
      lastIndexWithNullEnd,
      entries[lastIndexWithNullEnd].project,
      entries[lastIndexWithNullEnd].start,
      endDate,
    );
  }
  writelog();
}

async function editrunningentry(theproject) {
  // Find the index of the last item with a null value for "stop"
  let lastIndexWithNullEnd = -1;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].end === null) {
      lastIndexWithNullEnd = i;
      break;
    }
  }

  if (theproject == "") {
    theproject = entries[lastIndexWithNullEnd].project;
  }
  //console.log(project);
  // If there's an item with null stop date, update it
  if (lastIndexWithNullEnd !== -1) {
    editentry(
      lastIndexWithNullEnd,
      theproject,
      entries[lastIndexWithNullEnd].start,
      null,
    );
  }
}

// The dialog to be used for adding or editing an entry manually
// Use no arguments if adding, if editing, give the index number
async function editentrydialog(number = -1, body = "") {
  let theproject = "";
  let startDate = null;
  let endDate = null;

  const dialog = new Adw.AlertDialog({
    heading: "Add Entry",
    close_response: "cancel",
  });

  if (body != "") {
    dialog.body = body;
  }

  if (number != -1) {
    startDate = entries[number].start;
    endDate = entries[number].end;
    dialog.heading = "Edit Entry";
  }

  dialog.add_response("cancel", "Cancel");
  dialog.add_response("okay", "OK");

  dialog.set_response_appearance("okay", Adw.ResponseAppearance.SUGGESTED);

  const box = new Gtk.Box({
    orientation: 1,
    spacing: 6,
  });
  const projectlist2 = new Gtk.DropDown({
    enable_search: true,
  });
  box.append(projectlist2);
  const box0 = new Gtk.Box({
    orientation: 0,
    spacing: 12,
  });
  box.append(box0);
  const box1 = new Gtk.Box({
    orientation: 1,
    spacing: 6,
  });
  const box2 = new Gtk.Box({
    orientation: 1,
    spacing: 6,
  });
  box0.append(box1);
  box0.append(box2);
  const startentry = new Gtk.Entry();
  const endentry = new Gtk.Entry();
  const startlabel = new Gtk.Label();
  const endlabel = new Gtk.Label();
  startlabel.label = "Start Time";
  endlabel.label = "End Time";
  projectlist2.expression = listexpression;
  projectlist2.model = model;

  if (number != -1) {
    theproject = entries[number].project;
    // Set the selected project correctly
    let projectindex = projects.indexOf(theproject);
    console.log(theproject);
    console.log(projects);
    if (projectindex !== -1) {
      projectlist2.set_selected(projectindex);
    }

    startentry.set_text(startDate.toString());
    if (endDate !== null) {
      endentry.set_text(endDate.toString());
    }
  } else {
    const now = new Date();
    startentry.set_text(now.toString());
    endentry.set_text(now.toString());
  }

  box1.append(startlabel);
  box2.append(endlabel);
  box1.append(startentry);
  box2.append(endentry);

  dialog.set_extra_child(box);

  const response = await dialog.choose(workbench.window, null);
  if (response === "okay") {
    let validated = "";

    // Attempt to parse the date string
    startDate = new Date(startentry.get_text());

    if (isNaN(startDate.getTime())) {
      // If parsing fails, set validated message
      validated = "Start date is empty or is not a valid date. ";
    }

    const endentrytext = endentry.get_text();
    if (endentrytext !== "") {
      endDate = new Date(endentry.get_text());

      if (isNaN(endDate.getTime())) {
        // If parsing fails, set validated message
        validated += "End date is not a valid date. ";
      }
    } else {
      endDate = null;
      if (!logging) {
        validated += "End date is empty. ";
      }
    }

    if (endDate !== null && startDate > endDate) {
      validated += "End date is earlier than start date. ";
    }
    // If something goes wrong, set validated to an error message

    if (validated == "") {
      const selection = projectlist2.selected_item;
      const value = selection.value;
      if (selection) {
        theproject = value;
      }
      if (number == -1) {
        addentry(theproject, startDate, endDate);
      } else {
        editentry(number, theproject, startDate, endDate);
      }
      if (logging && endDate == null) {
        startedTime = startDate; // should go in if yes
      }
    } else {
      editentrydialog(
        number,
        "Your response was invalid. Reason: " + validated,
      );
    }
  }
}

async function editprojectdialog() {
  const dialog = new Adw.AlertDialog({
    heading: "Edit Projects",
    body: "Separate projects with line breaks.",
    close_response: "cancel",
  });

  dialog.add_response("cancel", "Cancel");
  dialog.add_response("okay", "OK");

  const view = new Gtk.TextView({
    editable: true,
  });
  const { buffer } = view;
  let editableProjects = projects.slice(1);
  buffer.set_text(editableProjects.join("\n"), -1);

  dialog.set_extra_child(view);

  dialog.set_response_appearance("okay", Adw.ResponseAppearance.SUGGESTED);
  const response = await dialog.choose(workbench.window, null);
  if (response === "okay") {
    const newprojects = buffer.get_text(
      buffer.get_start_iter(),
      buffer.get_end_iter(),
      false,
    );
    //console.log(newprojects);
    editableProjects = newprojects.split("\n");
    //console.log(editableProjects);
    setprojects(editableProjects);
    writesettings();
  }
}

async function editentry(number, theproject, startDate, endDate) {
  entries[number].project = theproject;
  entries[number].start = startDate;
  entries[number].end = endDate;
  let new_item = "";
  if (endDate === null) {
    new_item = "_h _m _s | Project: " + theproject;
  } else {
    new_item =
      calcTimeDifference(startDate, endDate) + " | Project: " + theproject;
    updatetotals();
  }
  logmodel.splice(number, 1, [new_item]);
  writelog();
}

// When called, start the running timer
async function startTimer() {
  setTimerText();
  timer = setInterval(setTimerText, 1000);
}

// When called, stop the running timer
async function stopTimer() {
  clearInterval(timer);
  setTimerText();
}

// When called, set the value for the timer to the correct value
async function setTimerText() {
  if (logging) {
    const currentDate = new Date();
    status.label = calcTimeDifference(startedTime, currentDate);
  } else {
    status.label = "0h 0m 0s";
  }
}

// If needed, display an alert window
async function alert(toShow) {
  const dialog = new Adw.AlertDialog({
    body: toShow,
  });
  dialog.add_response("ok", "OK");
  const response = await dialog.choose(workbench.window, null);
  return response;
}

// Calculate the difference between two times. textOutput decides whether it comes in 1h 34m 21s format, or whether it comes in seconds.
function calcTimeDifference(startTime, endTime, textOutput = true) {
  const timeDifference = endTime - startTime; // Time difference in milliseconds
  if (textOutput == false) {
    // {{{ Add code here that converts the difference to seconds.
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

// Change a date/time into the output format
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

async function updatetotals() {
  let totalString = "";
  let first = new Date();
  let last = new Date();
  first.setHours(0, 0, 0, 0);
  last.setHours(23, 59, 59, 999);
  totalString += "Today: " + createtotals(first, last);

  // Get today's date
  let today = new Date();

  // Initialize a variable to store the first Sunday found
  let firstSunday;

  // Start iterating backward from today
  for (let i = 0; i >= -6; i--) {
    const currentDate = new Date();
    currentDate.setDate(today.getDate() + i); // Set the current date to iterate

    // Check if the current date is a Sunday (day 0 in JavaScript's Date object)
    if (currentDate.getDay() === firstdayofweek) {
      firstSunday = currentDate;
      break; // Exit the loop once the first Sunday is found
    }
  }
  console.log(firstSunday);

  firstSunday.setHours(0, 0, 0, 0);
  today.setHours(23, 59, 59, 999);
  totalString += "\nThis week: " + createtotals(firstSunday, today);
  totallabel.label = totalString;
  // Make the first one the earliest possible time today
  // Second one is the latest possible time toda
}

function createtotals(startDate, endDate) {
  let totals = [];

  for (const entry of entries) {
    const start = entry.start;
    const end = entry.end;

    // Check if entry falls within the specified date range
    if (end !== null && start > startDate && end < endDate) {
      let sum = end.getTime() - start.getTime(); // Time difference in milliseconds
      sum = Math.floor(sum / 1000);

      // Check if project already exists in totals
      let found = false;
      for (const total of totals) {
        if (total.project === entry.project) {
          total.total += sum;
          found = true;
          break;
        }
      }

      // If project doesn't exist, add it to totals
      if (!found) {
        totals.push({ project: entry.project, total: sum });
      }
    }
  }
  console.log(totals);

  let resultString = totals
    .map((project) => `${project.project}: ${secondstoOutput(project.total)}`)
    .join(", ");
  console.log(resultString);
  return resultString;
}

function secondstoOutput(seconds) {
  const hours = Math.floor(seconds / 3600);
  seconds %= 3600;
  const minutes = Math.floor(seconds / 60);
  seconds %= 60;

  return hours + "h " + minutes + "m " + seconds + "s";
}

// Set the projects !!! needs work
function setprojects(projectArray = []) {
  let theproject = "";
  const selection = projectlist.selected_item;
  if (selection) {
    const value = selection.value;
    theproject = value.toString();
  }
  model.splice(0, projects.length, [new project({ value: "(no project)" })]);
  projects = ["(no project)"];
  if (projectArray.length > 0) {
    for (let i = 0; i < projectArray.length; i++) {
      model.splice(i + 1, 0, [new project({ value: projectArray[i] })]);
    }

    projects = projects.concat(projectArray);
    if (theproject != "") {
      let projectindex = projects.indexOf(theproject);

      if (projectindex !== -1) {
        projectlist.set_selected(projectindex);
      }
    }
  }
}
