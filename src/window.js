// Welcome to Time Tracker, a project licensed under the MIT-0 no attribution license.

// Handy page for styling info: https://gnome.pages.gitlab.gnome.org/libadwaita/doc/main/style-classes.html

// Perform the necessary imports
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import Adw from 'gi://Adw';
import GLib from 'gi://GLib';

// Make it possible to use async file loading and saving operations
Gio._promisify(Gio.File.prototype,
    'load_contents_async',
    'load_contents_finish');
Gio._promisify(Gio.File.prototype,
    'replace_contents_bytes_async',
    'replace_contents_finish');
Gio._promisify(Gio.File.prototype,
    'make_directory_async',
    'make_directory_finish');
Gio._promisify(Gio.File.prototype,
    'enumerate_children_async',
    'enumerate_children_finish');
Gio._promisify(Gio.File.prototype,
    'delete_async',
    'delete_finish');

// Declaring the variables
let logging = false; // Is the timer currently logging time?
let timer; // The timer for displaying the amount of time in the currently logging entry
let savetimer; // The autosave timer
let startedTime = new Date();
let entries = [];
let projects = [];
let logpath = "";
let firstdayofweek = 0;
let addprojectsfromlog = true;
let totalString = "";
let currentTimer = -1;
//let nopermissions = false; // Does the program have permission to read/write files?
let changestobemade = false;
let ampmformat = true;
let nochange = false;
let autosaveinterval = 5000;
let tick = 0;
let nexttick = 0;

// Creating the "project" class for displaying in the projectlist item
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

// Declaring the project content model
const model = new Gio.ListStore({ item_type: project });
const listexpression = Gtk.PropertyExpression.new(project, null, "value");

// Creating the "month" class for displaying in the monthlist item
const monthobj = GObject.registerClass(
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
  class monthobj extends GObject.Object {},
);

// Declaring the month content model
const monthmodel = new Gio.ListStore({ item_type: monthobj });
const monthexpression = Gtk.PropertyExpression.new(monthobj, null, "value");

// Get the local month names
const today = new Date();
const months = [];
for (let i = 0; i < 12; i++) {
  today.setMonth(i);
  months.push(today.toLocaleDateString(undefined, {month: "long"}));
  monthmodel.splice(i, 0, [new monthobj({ value: months[i] })]);
}

// Creating the main window of Time Tracker
export const TimeTrackerWindow = GObject.registerClass({
  GTypeName: 'TimeTrackerWindow',
  Template: 'resource:///com/lynnmichaelmartin/TimeTracker/window.ui',
  InternalChildren: ['status', 'startbutton', 'projectlist', 'list_box_editable', 'add', 'edit', 'remove', 'editproject', 'search_entry', 'totalbutton', 'toast_overlay'],
}, class TimeTrackerWindow extends Adw.ApplicationWindow {

  // Connecting with the gsettings for Time Tracker
  _settings = new Gio.Settings({ schemaId: 'com.lynnmichaelmartin.TimeTracker' });

  constructor(application) {
    super({ application });

    // Binding to the window size settings
    this._settings.bind(
        "window-width", this, "default-width", Gio.SettingsBindFlags.DEFAULT);
    this._settings.bind(
        "window-height", this, "default-height", Gio.SettingsBindFlags.DEFAULT);
    this._settings.bind(
        "window-maximized", this, "maximized", Gio.SettingsBindFlags.DEFAULT);

    // Applying the custom settings
    firstdayofweek = this._settings.get_int("firstdayofweek");
    addprojectsfromlog = this._settings.get_boolean("addprojectsfromlog");
    logpath = this._settings.get_string("log");
    const projectsSetting = this._settings.get_string("projects");
    try {
      this.setprojects(projectsSetting.split("`"));
    } catch (_) {
      this.setprojects();
    }

    // Connecting the start/stop button with the proper function
    const startstopAction = new Gio.SimpleAction({name: 'start'});
    startstopAction.connect('activate', () => this.startstop());
    this.add_action(startstopAction);

    // Connecting the "New Log" button with the proper function
    const newAction = new Gio.SimpleAction({name: 'new'});
    newAction.connect('activate', () => this.newlog());
    this.add_action(newAction);

    // Connecting the "Open Log" button with the proper function
    const openAction = new Gio.SimpleAction({name: 'open'});
    openAction.connect('activate', () => this.openlog());
    this.add_action(openAction);

    // Connecting the project model to projectlist
    this._projectlist.expression = listexpression;
    this._projectlist.model = model;

    // Connecting a change of selections in projectlist with the proper function
    this._projectlist.connect("notify::selected-item", () => {
      const selection = this._projectlist.selected_item;
      // When the selected project changes, change the project in the currently running entry, if any
      if (nochange) {
        nochange = false;
      } else {
        if (selection && logging) {
          const value = selection.value;
          this.editrunningentry(value);
          console.log("Selected project: " + value);
        }
      }
    });

    // Defining the model for the log
    this.logmodel = new Gtk.StringList();
    this.logmodel.connect("items-changed", (_self, position, removed, added) => {
      console.log(
        `position: ${position}, Item removed? ${Boolean(
          removed,
        )}, Item added? ${Boolean(added)}`,
      );
    });

    // Defining the searching and filtering model
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
      model: this.logmodel,
      filter: filter,
      incremental: true,
    });
    this._list_box_editable.bind_model(filter_model, this.createItemForFilterModel);

    // Connecting the add entry button with the proper function
    this._add.connect("clicked", () => {
      this.editentrydialog();
    });

    // Connecting the remove entry button with the proper function
    this._remove.connect("clicked", () => {
      const selectedRow = this._list_box_editable.get_selected_row();
      const index = selectedRow.get_index();
      this.removeentry(index);
    });

    // Connecting the edit entry button with the proper function
    this._edit.connect("clicked", () => {
      const selectedRow = this._list_box_editable.get_selected_row();
      const index = selectedRow.get_index();
      this.editentrydialog(index);
    });

    // Connecting the edit project button with the proper function
    this._editproject.connect("clicked", () => {
      this.editprojectdialog();
    });

    // Connecting the search entry with searching the log
    this._search_entry.connect("search-changed", () => {
      const searchText = this._search_entry.get_text();
      filter.search = searchText;
    });

    // Making the edit and remove buttons clickable when a log row is selected
    this._list_box_editable.connect("row-selected", () => {
      this._remove.sensitive = this._list_box_editable.get_selected_row() !== null;
      this._edit.sensitive = this._list_box_editable.get_selected_row() !== null;
    });

    // Connecting the button for displaying the reports
    this._totalbutton.connect("clicked", () => {
      this.alert(totalString);
    });

    // Connecting the "Test New Feature" button with the proper function
    const testAction = new Gio.SimpleAction({name: 'test'});
    testAction.connect('activate', async () => {
      this.runbackups();
    });
    this.add_action(testAction);

    // Connecting the edit project button with the proper function
    this.connect("close-request", () => {
      console.log("closing");
      if (changestobemade) {
        changestobemade = false;
        this.writelog();
      }
    });

    // Check if there's a user-selected log file, and load it; otherwise, prompt the user to create one
    if (logpath == "") {
      this.firstusedialog();
    } else {
      const file = Gio.File.new_for_path(logpath);
      if (file.query_exists(null)) {
        this.readfromfile();
      } else {
        this.firstusedialog(logpath);
      }
    }

    // All done constructing the window!
  }

  // When the autosave timer fires, check to see if there are any changes in the queue
  async shouldsave() {
    tick += 1;
    if (changestobemade) {
      changestobemade = false;
      this.writelog();
    }
    try {
      if (tick >= nexttick) {
        // Set up tomorrow's backup at 1 AM if the program isn't closed
        const now = new Date();
        const nextmorning = new Date();
        nextmorning.setDate(now.getDate() + 1);
        nextmorning.setHours(1, 0, 0, 0);
        const tickstogo = Math.floor((nextmorning - now) / autosaveinterval);
        nexttick += tickstogo;

        // Run auto backup
        this.runbackups();
      }
    } catch (_) {
      // Backups failed
    }
  }

  // Present a dialog for creating a new log file
  async newlog(firsttime = false) {
    console.log("Create new log file");
    const fileDialog = new Gtk.FileDialog();

    fileDialog.save(this, null, async (self, result) => {
      try {
        const file = self.save_finish(result);

        if (file) {
          if (logpath.includes("file:///run/user/")) {
            //nopermissions = true;
            const errormessage = "You have not given Time Tracker the permission to read/write files in the home directory. Time Tracker cannot run without these permissions. You may want to configure this with FlatSeal.";
            console.log(errormessage);
            this.alert(errormessage);
          } else {
            logpath = file.get_path();
            console.log(logpath);
            this._settings.set_string("log", logpath);
            this.writelog();

            // Set up autosave timer
            this.setautosavetimer();
          }
        }
      } catch(_) {
        // user closed the dialog without selecting any file
        if (firsttime) {
          // Don't let them get away without creating a log of some kind
          this.firstusedialog();
        }
      }
    });
  }

  async setautosavetimer() {
    tick = 0;
    nexttick = 300000 / autosaveinterval; // The next time to check for daily activities (5 min from now)
    savetimer = setInterval(() => this.shouldsave(), autosaveinterval);
  }

  // Present a dialog for opening an existing log file
  async openlog(firsttime = false) {
    console.log("Open existing log file");   // Create a new file selection dialog
    const fileDialog = new Gtk.FileDialog();

    // Open the dialog and handle user's selection
    fileDialog.open(this, null, async (self, result) => {
      try {
        const file = self.open_finish(result);

        if (file) {
          if (logpath.includes("file:///run/user/")) {
            //nopermissions = true;
            const errormessage = "You have not given Time Tracker the permission to read/write files in the home directory. Time Tracker cannot run without these permissions. You may want to configure this with FlatSeal.";
            console.log(errormessage);
            this.alert(errormessage);
          } else {
            logpath = file.get_path();
            console.log(logpath);
            this.readfromfile();
            this._settings.set_string("log", logpath);
          }
        }
      } catch(_) {
         // user closed the dialog without selecting any file
        if (firsttime) {
          // Don't let them get away without creating a log of some kind
          this.firstusedialog();
        }
      }
    });
  }

  // Convert the log array into CSV format
  async writelog(filepath = logpath, notify = true) {
    let entriesString = "Project,Start Time,End Time\n";

    for (let i = 0; i < entries.length; i++) {
      let project = "";
      let start = "";
      let end = "";
      try {
         project = entries[i].project;
         start = entries[i].start;
         end = entries[i].end;
      } catch (_) {
        // Something was empty
      }
      entriesString += project + "," + start + "," + end;
      if (i < entries.length - 1) {
        entriesString += '\n';
      }
    }

    this.writetofile(filepath, entriesString, notify);
  }

  // Write the given text to the log file
  async writetofile(filepath, text, notify = true) {
    const file = Gio.File.new_for_path(filepath);
    console.log("Attempting to write to " + filepath);
    //text = "Testing this.";
    try {
      // Save the file (asynchronously)
      await file.replace_contents_bytes_async(
        new GLib.Bytes(text),
        null,
        false,
        Gio.FileCreateFlags.REPLACE_DESTINATION,
        null);
      if (notify) {
        this._toast_overlay.add_toast(Adw.Toast.new(`Saved to file ${filepath}`));
      }
    } catch(e) {
      logError(`Unable to save to ${filepath}: ${e.message}`);
      if (notify) {
        this._toast_overlay.add_toast(Adw.Toast.new(`Failed to save to file ${filepath}`));
      }
    }
  }

  // Remove the given entry from the entries array and the log control
  async removeentry(number) {
    if (number == currentTimer) {
      this.stopTimer();
    }
    entries.splice(number, 1);
    this.logmodel.remove(number);
    changestobemade = true;
    this.updatetotals();
  }

  // Stop the entry currently in the timer with the given end date
  async stoprunningentry(endDate) {
    if (currentTimer !== -1) {
      this.editentry(
        currentTimer,
        entries[currentTimer].project,
        entries[currentTimer].start,
        endDate,
      );
    }
    changestobemade = true;
  }

  // Update the project of the currently running entry
  async editrunningentry(theproject) {
    if (currentTimer !== -1) {
      //Is this code needed?
      if (theproject == "") {
        theproject = entries[currentTimer].project;
      }
      this.editentry(currentTimer, theproject, entries[currentTimer].start, null);
    }
  }

  // The dialog to be used when a user wishes to add or edit an entry manually.
  // Use no arguments if adding an entry, if editing, give the index number
  async editentrydialog(number = -1, body = "") {
    let theproject = "";
    let startDate = new Date();
    let endDate = new Date();

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
    const startb = new Gtk.Button();
    startb.connect("clicked", () => {
      this.datedialog(startDate, (date) => {
        startDate = date;
        startb.label = this.datetotext(date);
      });
    });
    const endb = new Gtk.Button();
    endb.connect("clicked", () => {
      if (endDate != null) {
        this.datedialog(endDate, (date) => {
          endDate = date;
          endb.label = this.datetotext(date);
        });
      } else {
        this.datedialog(new Date(), (date) => {
          endDate = date;
          endb.label = this.datetotext(date);
        });
      }
    });
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
      if (projectindex !== -1) {
        projectlist2.set_selected(projectindex);
      }

      startb.label = this.datetotext(startDate);
      if (endDate !== null) {
        endb.label = this.datetotext(endDate);
      }
    } else {
      const now = new Date();
      startb.label = this.datetotext(now);
      endb.label = this.datetotext(now);
    }

    box1.append(startlabel);
    box2.append(endlabel);
    box1.append(startb);
    box2.append(endb);

    dialog.set_extra_child(box);

    dialog.connect("response", (_, response_id) => {
      console.log(response_id);
      if (response_id === "okay") {
        let validated = "";

        if (endDate !== null && startDate > endDate) {
          validated += "End date is earlier than start date. ";
        }

        if (validated == "") {
          const selection = projectlist2.selected_item;
          const value = selection.value;
          if (selection) {
            theproject = value;
          }
          if (number == -1) {
            console.log("Adding " + theproject + " " + startDate + " " + endDate)
            this.addentry(theproject, startDate, endDate);
          } else {
            console.log("Editing " + number + " " + theproject + " " + startDate + " " + endDate)
            this.editentry(number, theproject, startDate, endDate);
          }
          if (logging && endDate == null) {
            startedTime = startDate; // should go in if yes
          }
        } else {
          this.editentrydialog(
            number,
            "Your response was invalid. Reason: " + validated,
          );
        }
      }
    });

    dialog.present(this);
  }

  // Present a dialog where the user can edit the projects that show in the projectlist
  async editprojectdialog() {
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

    dialog.connect("response", (_, response_id) => {
      if (response_id === "okay") {
        let newprojects = buffer.get_text(
          buffer.get_start_iter(),
          buffer.get_end_iter(),
          false,
        );
        // Remove leading and trailing line breaks
        newprojects = newprojects.trim();

        // Ensure there are never two line breaks following each other
        newprojects = newprojects.replace(/\n\n/g, "\n");

        // Remove any commas
        newprojects = newprojects.replace("`", "'");

        editableProjects = newprojects.split("\n");
        let newArray = [];
        let newString = "";

        for (let i = 0; i < editableProjects.length; i++) {
          const proj = editableProjects[i];
          if (proj != "") {
            newArray.push(proj);
            newString += proj;
            if (i < editableProjects.length - 1) {
              newString += "`";
            }
          }
        }
        this.setprojects(newArray);
        this._settings.set_string("projects", newString);
      }
    });

    dialog.present(this);
  }

  // Edit the given entry in the entries array and the log control
  async editentry(number, theproject, startDate, endDate) {
    // Stop the timer if the entry didn't have an end date, but does now
    if (entries[number].end == null && endDate != null) {
      this.stopTimer();
    }
    entries[number].project = theproject;
    entries[number].start = startDate;
    entries[number].end = endDate;
    let new_item = "";
    if (endDate === null) {
      new_item = "[logging] | Project: " + theproject;
    } else {
      new_item =
        this.calcTimeDifference(startDate, endDate) + " | Project: " + theproject;
      this.updatetotals();
    }
    this.logmodel.splice(number, 1, [new_item]);
    changestobemade = true;
  }

  // Add the given entry to the entries array and the log control
  async addentry(project, startDate, endDate = null) {
    entries.push({ start: startDate, end: endDate, project: project });

    let new_item = "";
    if (endDate === null) {
      new_item = "[logging] | Project: " + project;
      console.log(new_item);
      this.logmodel.append(new_item);
    } else {
      new_item =
        this.calcTimeDifference(startDate, endDate) + " | Project: " + project;
      this.logmodel.append(new_item);
      this.updatetotals();
    }
    changestobemade = true;
  }

  // Something to do with searching the log control
  createItemForFilterModel(listItem) {
    const listRow = new Adw.ActionRow({
      title: listItem.string,
    });
    return listRow;
  }

  // Replace the current projects with the given projects in the array. If a project was selected already, try to select that same project when the projectlist reloads.
  async setprojects(projectArray = []) {
    const selection = this._projectlist.get_selected();
    const theproject = projects[selection];
    if (theproject != "") {
      nochange = true; // There wasn't actually a change, so don't do anything when the selected-changed event is called
    }
    model.splice(0, projects.length, [new project({ value: "(no project)" })]);
    projects = ["(no project)"];
    if (projectArray.length > 0) {

      this.addprojects(projectArray);

      if (theproject != "") {
        let projectindex = projects.indexOf(theproject);

        if (projectindex !== -1) {
          nochange = true; // There wasn't actually a change, so don't do anything when the selected-changed event is called
          this._projectlist.set_selected(projectindex);
        }
      }
    }
  }

  addprojects(projectArray) {
    const len = projects.length;
    for (let i = 0; i < projectArray.length; i++) {
      model.splice(i + len, 0, [new project({ value: projectArray[i] })]);
    }
    projects = projects.concat(projectArray);
  }

  // When the user clicks the start/stop button, do the right action
  async startstop() {
    const currentDate = new Date();
    const selection = this._projectlist.get_selected();
    const selectionText = projects[selection];

    console.log("Is timer on? " + logging.toString());
    if (logging) {
      this._startbutton.label = "Start";
      this.stoprunningentry(currentDate);
    } else {
      this._startbutton.label = "Stop";
      this.addentry(selectionText, currentDate);
      startedTime = currentDate;
      this.startTimer(entries.length - 1);
    }
  }

  // When the timer needs to be stopped, stop it
  async stopTimer() {
    logging = false;
    clearInterval(timer);
    this.setTimerText();

    try {
      this._projectlist.set_selected(0); // Reset project to (no project)
    } catch (error) {
      console.log(error);
    }
    currentTimer = -1;
    console.log("Timer has been stopped.");
  }

  // When called, set the value for the timer to the correct value
  async setTimerText() {
    if (logging) {
      const currentDate = new Date();
      this._status.label = this.calcTimeDifference(startedTime, currentDate);
    } else {
      this._status.label = "0h 0m 0s";
    }
  }

  // Calculate the difference between two times. textOutput decides whether it comes in 1h 34m 21s format, or whether it comes in seconds.
  // There's another function somewhere that ought to be going through this one {{{
  calcTimeDifference(startTime, endTime, textOutput = true) {
    const timeDifference = Math.floor((endTime - startTime) / 1000); // Time difference in seconds
    if (textOutput == false) {
      return timeDifference;
    } else {
      return this.secondstoOutput(timeDifference);
    }
  }

  // Start the timer
  async startTimer(number) {
    logging = true;
    this.setTimerText();
    timer = setInterval(() => this.setTimerText(), 1000);
    currentTimer = number;
    console.log("Timer has been started.");
  }

  // Convert from seconds to output format
  secondstoOutput(seconds) {
    const hours = Math.floor(seconds / 3600);
    seconds = seconds - (hours * 3600);
    const minutes = Math.floor(seconds / 60);
    seconds = seconds - (minutes * 60);

    return this.intto2digitstring(hours) + ":" + this.intto2digitstring(minutes) + ":" + this.intto2digitstring(seconds);
  }

  // If needed, display an alert window. This should be deprecated at some point
  async alert(toShow) {
    const dialog = new Adw.AlertDialog({
      body: toShow,
    });
    dialog.add_response("ok", "OK");
    const response = await dialog.choose(this, null, null);
    return response;
  }

  // Update the total quantities for today, this week, and last week
  // Not very well written; should be updated. {{{
  async updatetotals() {
    let first = new Date();
    let last = new Date();
    first.setHours(0, 0, 0, 0);
    last.setHours(23, 59, 59, 999);
    totalString = "Today: " + this.createtotals(first, last);

    let today = new Date();
    let firstDay;

    // Get the first day of this week
    for (let i = 0; i >= -6; i--) {
      let currentDate = new Date();
      currentDate.setDate(today.getDate() + i);
      if (currentDate.getDay() === firstdayofweek) {
        firstDay = currentDate;
        break;
      }
    }

    firstDay.setHours(0, 0, 0, 0);
    today.setHours(23, 59, 59, 999);
    let lastLast = new Date(firstDay);
    lastLast.setDate(firstDay.getDate() - 1); // Get the day one day before firstDay

    let firstLast = new Date(firstDay);
    firstLast.setDate(firstDay.getDate() - 7); // Get the day one week before firstDay
    firstLast.setHours(0, 0, 0, 0);
    lastLast.setHours(23, 59, 59, 999);
    totalString += "\nThis week: " + this.createtotals(firstDay, today);
    totalString += "\nLast week: " + this.createtotals(firstLast, lastLast);
  }

  // Find the total time between two dates, and output it by project
  // Should make it possible to output the total too {{{
  createtotals(startDate, endDate) {
    let totals = [];

    // Is there a better way to do this?
    for (const entry of entries) {
      const start = entry.start;
      const end = entry.end;

      if (end !== null && start > startDate && end < endDate) {
        let sum = end.getTime() - start.getTime(); // Time difference in milliseconds
        sum = Math.floor(sum / 1000);

        // Check if project already exists in totals
        let found = false;
    // Is there a better way to do this?
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

    let resultString = "";
    for (let i = 0; i < totals.length; i++) {
      let thetotal = this.secondstoOutput(totals[i].total);
      resultString += totals[i].project + ": " + thetotal;

      if (i !== totals.length - 1) {
        resultString += ", ";
      }
    }

    return resultString;
  }

  async datedialog(date = new Date(), tocall = null, body = "", ampm = true) {
    const dialog = new Adw.AlertDialog({
      heading: "Choose the Date & Time",
      close_response: "cancel",
    });

    if (body != "") {
      dialog.body = body;
    }

    dialog.add_response("cancel", "Cancel");
    dialog.add_response("okay", "OK");

    dialog.set_response_appearance("okay", Adw.ResponseAppearance.SUGGESTED);

    const box = new Gtk.Box({
      orientation: 1,
      spacing: 6,
    });
    const buttonbox = new Gtk.Box({
      orientation: 0,
      spacing: 12,
    });
    box.append(buttonbox);
    const datebox = new Gtk.Box({
      orientation: 0,
      spacing: 12,
    });
    box.append(datebox);
    const timebox = new Gtk.Box({
      orientation: 0,
      spacing: 12,
    });
    box.append(timebox);
    const monthlist = new Gtk.DropDown({
      enable_search: true,
    });
    const hmbox = new Gtk.Box({
      orientation: 1,
      spacing: 6,
    });
    timebox.append(hmbox);
    const secondbox = new Gtk.Box({
      orientation: 1,
      spacing: 6,
    });
    timebox.append(secondbox);
    const dayspin = new Adw.SpinRow();
    const yearspin = new Adw.SpinRow();
    const hourminuteentry = new Gtk.Entry();
    const hourminutelabel = new Gtk.Label();
    const secondentry = new Gtk.Entry();
    const secondlabel = new Gtk.Label();
    const todaybutton = new Gtk.Button();
    const yesterdaybutton = new Gtk.Button();

    const am = new Gtk.ToggleButton;
    const pm = new Gtk.ToggleButton;

    todaybutton.label = "Today";
    todaybutton.connect("clicked", () => {
      let today = new Date();
      monthlist.set_selected(today.getMonth());
      dayspin.set_value(today.getDate());
      yearspin.set_value(today.getFullYear());
    });
    yesterdaybutton.label = "Yesterday";
    yesterdaybutton.connect("clicked", () => {
      let yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      monthlist.set_selected(yesterday.getMonth());
      dayspin.set_value(yesterday.getDate());
      yearspin.set_value(yesterday.getFullYear());
    });

    // Set the day range before setting the month value
    dayspin.set_range(1,new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate());
    const dayinc = dayspin.get_adjustment();
    dayinc.set_step_increment(1);

    // Set the year range
    yearspin.set_range(2000,3000);
    const yearinc = yearspin.get_adjustment();
    yearinc.set_step_increment(1);

    // Set year value before setting day value
    yearspin.set_value(date.getFullYear());

    // Set the monthlist contents
    monthlist.expression = monthexpression;
    monthlist.model = monthmodel;

    // Set monthlist selection
    try {
      monthlist.set_selected(parseInt(date.getMonth()));
    } catch (error) {
      console.log("Failed to set month date");
    }

    // When monthlist selection changed, make number of days in day entry be correct
    monthlist.connect("notify::selected-item", () => {
      // is there a better way of doing this?
      const daysinmonth = new Date(yearspin.get_value(), monthlist.get_selected() + 1, 0).getDate();
      dayspin.set_range(1,daysinmonth);
    });

    dayspin.set_value(date.getDate());
    let inputhour = date.getHours();
    if (ampm) {
      if (inputhour >= 13) {
        inputhour -= 12;
        pm.set_active(true);
      } else {
        am.set_active(true);
      }
    }
    let hourString = (inputhour * 100 + date.getMinutes()).toString()
    if (inputhour < 1) {
      hourString = "0" + intto2digitstring(date.getMinutes());
    }
    hourminuteentry.set_text(hourString);

    /* can't seem to focus the entry or get when it is edited {{{
    hourminuteentry.connect("notify::key-press-event", () => {
      secondentry.set_text("00");
    });
    */
    secondentry.set_text(this.intto2digitstring(date.getSeconds()));

    hourminutelabel.label = "Hours & Minutes, as in \"1130\"";
    secondlabel.label = "Seconds";

    buttonbox.append(yesterdaybutton);
    buttonbox.append(todaybutton);
    datebox.append(monthlist);
    datebox.append(dayspin);
    datebox.append(yearspin);
    hmbox.append(hourminutelabel);
    hmbox.append(hourminuteentry);
    secondbox.append(secondlabel);
    secondbox.append(secondentry);
    if (ampm) {
      am.label = "AM";
      pm.label = "PM";
      timebox.append(am);
      timebox.append(pm);
      am.connect("toggled", () => {
        if (am.get_active()) {
          pm.set_active(false);
        } else {
          pm.set_active(true);
        }
      });
      pm.connect("toggled", () => {
        if (pm.get_active()) {
          am.set_active(false);
        } else {
          am.set_active(true);
        }
      });
    }

    dialog.set_extra_child(box);

    // Doesn't work {{{
    dayspin.grab_focus();

    dialog.connect("response", (_, response_id) => {
      console.log(response_id);
      if (response_id === "okay") {
        let chosendate = new Date();
        let hour = Math.floor(parseInt(hourminuteentry.get_text()) / 100);
        let minute = hourminuteentry.get_text() - (hour * 100);
        let second = parseInt(secondentry.get_text());
        if (isNaN(second)) {
          second = 0;
        }
        chosendate.setDate(dayspin.get_value());
        chosendate.setMonth(monthlist.get_selected());
        chosendate.setFullYear(yearspin.get_text());
        chosendate.setHours(hour);
        chosendate.setMinutes(minute);
        chosendate.setSeconds(parseInt(secondentry.get_text()));
        chosendate.setMilliseconds(0);
        if (ampm && pm.get_active() && hour > 0 && hour < 12) {
          chosendate.setHours(chosendate.getHours() + 12);
        }
        console.log("Selected date: " + chosendate);

        if (isNaN(chosendate.getTime())) {
          // If parsing fails, set validated message
          this.datedialog(date,tocall,"The entry was not a valid date or time.");
        } else {
          // If a callback function was given, call that function with the discovered date
          if (tocall && typeof tocall === 'function') {
            tocall(chosendate);
          }
        }
      }
    });

    dialog.present(this);
  }

  intto2digitstring(int) {
    int = Math.floor(int);
    let thestring = int.toString();
    if (int < 10) {
      if (int > 0) {
        thestring = "0" + thestring;
      } else {
        thestring = "00";
      }
    }
    return thestring;
  }

  datetotext(date, ampm = ampmformat) {
    let dateString = date.toString();
    const year = date.getFullYear().toString();

    const index = dateString.indexOf(year);
    dateString = dateString.slice(0, index + year.length) + "\n";

    var hours = date.getHours();
    var minutes = date.getMinutes();
    var seconds = date.getSeconds();
    if (ampm) {
      let format = "AM";
      if (hours > 12) {
        format = "PM";
        hours -= 12;
      } else if (hours > 11) {
        format = "PM";
      } else if (hours == 0) {
        hours = 12;
      }
      dateString += hours.toString() + ":" + this.intto2digitstring(minutes) + ":" + this.intto2digitstring(seconds) + " " + format;
    } else {
      dateString += hours.toString() + ":" + this.intto2digitstring(minutes) + ":" + this.intto2digitstring(seconds);
    }
    return dateString;
  }

  // Replace all entries by importing an array of time entries
  async setentries(readentries) {
    let new_items = [];
    for (let i = 0; i < readentries.length; i++) {
      let new_item = "";
      //console.log(readentries[i].end);
      if (readentries[i].end === null) {
        //console.log("confirmed null");
        new_item = "[logging] | Project: " + readentries[i].project;
        new_items.push(new_item);
      } else {
        new_item =
          this.calcTimeDifference(readentries[i].start, readentries[i].end) + " | Project: " + readentries[i].project;
        new_items.push(new_item);
      }
    }
    this.logmodel.splice(0, entries.length, new_items);
    entries = readentries;

    // See if there's a currently running entry, and get all the projects
    let latestStartDate = null;
    let latestStartIndex = -1;
    let latestStartProject = "";

    let projectsfromlog = [];

    // Could at least part of this be merged with the above for loop?
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (entry.end === null) {
        if (latestStartDate === null || entry.start > latestStartDate) {
          latestStartDate = entry.start;
          latestStartIndex = i;
          latestStartProject = entry.project;
        }
      }
      if (addprojectsfromlog) {
        if (projects.indexOf(entry.project) == -1 && projectsfromlog.indexOf(entry.project) == -1) {
          projectsfromlog.push(entry.project);
        }
      }
    }

    if (addprojectsfromlog && projectsfromlog.length > 0) {
      this.addprojects(projectsfromlog);

      let projectString = "";
      for (let i = 1; i < projects.length - 1; i++) {
        projectString += projects[i] + "`";
      }
      projectString += projects[projects.length - 1];
      this._settings.set_string("projects", projectString);
    }

    let projectindex = projects.indexOf(latestStartProject);
    if (projectindex !== -1) {
      nochange = true; // There wasn't actually a change, so don't do anything when the selected-changed event is called
      this._projectlist.set_selected(projectindex);
    }

    // Start timer
    if (latestStartIndex > -1) {
      this.startTimer(latestStartIndex);
      startedTime = latestStartDate;
      this._startbutton.label = "Stop";
    }

    // Start autosave timer
    this.setautosavetimer();
    this.updatetotals();
  }

  // Take a given string and convert it to an array that can be imported into time entries
  async readlog(text) {
    let projectColumn = 0;
    let startColumn = 1;
    let endColumn = 2;
    let idColumn = 3;

    let readentries = [];

    let lines = text.split('\n');
    for (let i = 1; i < lines.length; i++) {
      let strings = lines[i].split(',');
      //let endvalue = null;
      //console.log(strings[endColumn]);
      let endvalue = new Date(strings[endColumn]);
      if (isNaN(endvalue)) {
        endvalue = null;
      }
      let projvalue = strings[projectColumn];
      if (projvalue == "") {
        projvalue = "(no project)";
      }
      readentries.push({
        start: new Date(strings[startColumn]),
        end: endvalue,
        project: projvalue
      });
    }
    this.setentries(readentries);
  }

  // Read text from a file and serve it to function that converts it into the application's entry format
  async readfromfile(thepath = logpath) {
    console.log("Will read from this file: " + thepath);
    const file = Gio.File.new_for_path(thepath);
    let contentsBytes;
    try {
      contentsBytes = (await file.load_contents_async(null))[0];
    } catch (e) {
      console.log(e, `Unable to open ${file.peek_path()}`);
      return;
    }

    try {
      if (!GLib.utf8_validate(contentsBytes)) {
        console.log(`Invalid text encoding for ${file.peek_path()}`);
        return;
      }
    } catch (error) {
      console.log("validate failed: " + error);
    }

    // Convert a UTF-8 bytes array into a String
    const contentsText = new TextDecoder('utf-8').decode(contentsBytes);
    this.readlog(contentsText);
  }

  // This is a work in progress, and will replace the current method of opening a new file
  firstusedialog(thepath = "") {
    const dialog = new Adw.AlertDialog({
      close_response: "cancel",
    });

    if (thepath == "") {
      dialog.heading = "Welcome to Time Tracker!";
      dialog.body = "Before you start using Time Tracker, choose where " +
      "to store your time logs. You can also edit other settings, like " +
      "the first day of the week, in Time Tracker preferences.";
    } else {
      dialog.heading = "Choose a Log File";
      dialog.body = "Time Tracker couldn't find the previously-used log " +
      "file: " + thepath + ". Please choose the log again or choose a new one.";
    }

    dialog.add_response("option1", "Use App's System Folder");
    dialog.add_response("option2", "Create New Log");
    dialog.add_response("option3", "Use Existing Log");

    dialog.connect("response", async (_, response_id) => {
      if (response_id === "option2") {
        this.newlog(true);
      } else if (response_id === "option3") {
        this.openlog(true);
      } else {
        // system folder
        const filepath = GLib.build_filenamev([GLib.get_home_dir(), '.local/share/time-tracker']);
        const directory = Gio.File.new_for_path(filepath);
        let success = false;
        try {
          success = await directory.make_directory_async(GLib.PRIORITY_DEFAULT, null);
        } catch (_) {
          // Folder already existed?
        }
        console.log("Tried to write directory " + filepath + ". Success? " + success);
        logpath = filepath + "/log.csv";
        //console.log(logpath);
        this._settings.set_string("log", logpath);
        // Need to check if file exists
        const file = Gio.File.new_for_path(logpath);
        if (file.query_exists(null)) {
          this.readfromfile();
        } else {
          this.writelog();
        }
        // Set up autosave timer
        this.setautosavetimer();
      }
    });

    dialog.present(this);
  }

  async runbackups(deleteold = true) {
    console.log("Trying to do a backup");
    try {
      const filepath = GLib.build_filenamev([GLib.get_home_dir(), '.local/share/time-tracker']);
      const directory = Gio.File.new_for_path(filepath);
      const iter = await directory.enumerate_children_async('standard::*',
          Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, GLib.PRIORITY_DEFAULT, null);

      // Find all files in directory
      let files = [];
      for await (const fileInfo of iter)
          files.push(fileInfo.get_name());

      // Check if a backup was made today
      let today = new Date();
      let todaysname = "backup_" + today.getFullYear() +
      "-" + this.intto2digitstring(today.getMonth()+1) + "-" +
      this.intto2digitstring(today.getDate()) + ".csv";
      let todaysbackup = files.indexOf(todaysname);
      //console.log(todaysname);
      //console.log(todaysbackup);

      if (todaysbackup == -1) {
        // Run backup
        this.writelog(filepath + "/" + todaysname, false);
        console.log("Saved a backup for today");
        files.push(todaysname);
      }

      // Clean up extra backups according to numberofbackups
      if (deleteold) {
        files.sort();
        let filestodelete = [];
          let numberofbackups = 7;
        try {
          numberofbackups = this._settings.get_int("numberofbackups");
        } catch (_) {
        }
        let number = 0;
        for (let i = files.length-1; i > -1; i--) {
          if (files[i].indexOf("backup_" + today.getFullYear()) > -1 || files[i].indexOf("backup_" + today.getFullYear())-1 > -1) {
            if (number <= numberofbackups) {
              number += 1;
            } else {
              filestodelete.push(files[i]);
            }
          }
        }

        // delete filestodelete
        if (filestodelete.length > 0) {
          for (let i = 0; i < filestodelete.length; i++) {
            const file = Gio.File.new_for_path(filepath + "/" + filestodelete[i]);

            await file.delete_async(GLib.PRIORITY_DEFAULT, null);
          }
          console.log("Deleted old backups: " + filestodelete);
        }
      }
    } catch (e) {
      console.log("Tried to save backup, but failed: " + e);
    }
  }
});
