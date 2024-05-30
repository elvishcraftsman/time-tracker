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
let sync_timer; // The sync timer
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
let sync_interval = 1000;
let tick = 0;
let nexttick = 0;
let customstart = null;
let customend = null;
let sync_operation = 0; // Is a current operation trying to sync?
let sync_changes = []; // Changes to be synced
// type, project, start, stop, ID, oldproject, oldstart, oldstop, written, validated
let sync_extraentries = []; // Entries not to be read into entries array, but to be written to the log file
let sync_firsttime = true;
//let changemadebyself = false;
//let fileMonitor;
//let sync_memory;

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

// Creating the "month" class for displaying in the monthlist item
const weekobj = GObject.registerClass(
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
  class weekobj extends GObject.Object {},
);

// Declaring the month content model
const weekmodel = new Gio.ListStore({ item_type: weekobj });
const weekexpression = Gtk.PropertyExpression.new(weekobj, null, "value");

// Get the local weekday names
const today2 = new Date();
const weekdays = [];
for (let i = 0; i < 7; i++) {
  const day = new Date(today2.setDate(today2.getDate() - today2.getDay() + i));
  weekdays.push(day.toLocaleDateString("default", { weekday: 'long' }));
  weekmodel.splice(i, 0, [new weekobj({ value: weekdays[i] })]);
}

// Creating the main window of Time Tracker
export const TimeTrackerWindow = GObject.registerClass({
  GTypeName: 'TimeTrackerWindow',
  Template: 'resource:///com/lynnmichaelmartin/TimeTracker/window.ui',
  InternalChildren: ['status', 'startbutton', 'projectlist',
  'list_box_editable', 'add', 'search_entry',
  'toast_overlay', 'customlabel', 'todaylabel', 'thisweeklabel',
  'lastweeklabel', 'reportstart', 'reportend'],
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
    sync_interval = this._settings.get_int("syncinterval") * 1000;
    addprojectsfromlog = this._settings.get_boolean("addprojectsfromlog");
    ampmformat = this._settings.get_boolean("ampmformat");
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

    // Connecting the "Open Log" button with the proper function
    const projectsAction = new Gio.SimpleAction({name: 'projects'});
    projectsAction.connect('activate', () => this.editprojectdialog());
    this.add_action(projectsAction);

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
        }
      }
    });

    // Defining the model for the log
    this.logmodel = new Gtk.StringList();
    /*this.logmodel.connect("items-changed", (_self, position, removed, added) => {
      console.log(
        `position: ${position}, Item removed? ${Boolean(
          removed,
        )}, Item added? ${Boolean(added)}`,
      );
    });*/

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

    this._reportstart.connect("clicked", () => {
      this.datedialog(customstart, (date) => {
        customstart = date;
        this._reportstart.label = this.datetotext(date);
        this.updatetotals();
      });
    });

    this._reportend.connect("clicked", () => {
      this.datedialog(customend, (date) => {
        customend = date;
        this._reportend.label = this.datetotext(date);
        this.updatetotals();
      });
    });

    /* Connecting the remove entry button with the proper function
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
    */

    /* Connecting the edit project button with the proper function
    this._editproject.connect("clicked", () => {
      this.editprojectdialog();
    });
*/
    // Connecting the search entry with searching the log
    this._search_entry.connect("search-changed", () => {
      const searchText = this._search_entry.get_text();
      filter.search = searchText;
    });

    // Making the edit and remove buttons clickable when a log row is selected
    this._list_box_editable.connect("row-selected", () => {
      //this._remove.sensitive = this._list_box_editable.get_selected_row() !== null;
      //this._edit.sensitive = this._list_box_editable.get_selected_row() !== null;

      const selectedRow = this._list_box_editable.get_selected_row();
      if (selectedRow) {
        const index = selectedRow.get_index();
        this._list_box_editable.unselect_all();
        this.editentrydialog(entries.length - 1 - index);
      }
    });

    // Connecting the "Test New Feature" button with the proper function
    const prefsAction = new Gio.SimpleAction({name: 'preferences'});
    prefsAction.connect('activate', async () => {
      this.preferencesdialog();
    });
    this.add_action(prefsAction);

    // Autosaving before close
    this.closehandler = this.connect("close-request", async () => {
      // Make it possible to close the window
      this.disconnect(this.closehandler);
      console.log("closing");
      if (changestobemade) {
        changestobemade = false;
        await this.writelog();
      }
      setInterval(() => {this.close()}, 10); // Call something else that will actually close the window
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

  // The function to sync with the log file
  async sync() {
    /* Currently, the sync function works like this:
        - If there are backups to be run, make the backup
        - If there are any changes to be made to the log, make the changes
        - If not, read the file to see if any changes were made in the file
       In future, it will do this instead:
        - If there are backups to be run, make the backup
        - Read the file to see if any changes were made in the file
        - (In a different function) If this loses any information that was
          just written to the file or was not yet written to the file, then
          write those changes to the file.
    */

    // Stop sync timer
    clearInterval(sync_timer);

    tick += 1;
    // Run backups
    try {
      if (tick >= nexttick) {
        // Set up tomorrow's backup at 1 AM if the program isn't closed
        const now = new Date();
        const nextmorning = new Date();
        nextmorning.setDate(now.getDate() + 1);
        nextmorning.setHours(1, 0, 0, 0);
        const tickstogo = Math.floor((nextmorning - now) / sync_interval);
        nexttick += tickstogo;

        // Run auto backup
        this.runbackups();
      }
    } catch (_) {
      // Backups failed
    }

    // If there are any changes to write out, write them out
    if (changestobemade) {
      changestobemade = false;
      this.writelog();
    } else {
      // Sync to the file
      this.readfromfile();
    }

    // Start sync timer
    this.resetsynctimer();
  }

  // Present a dialog for creating a new log file
  async newlog(insist = false) {
    console.log("Creating new log file");
    const fileDialog = new Gtk.FileDialog();

    // Add filters
    const fileFilter1 = new Gtk.FileFilter();
    fileFilter1.add_suffix("csv");
    fileFilter1.set_name("Comma-Separated Values");
    const fileFilter2 = new Gtk.FileFilter();
    fileFilter2.add_pattern("*");
    fileFilter2.set_name("All Files");
    const filterlist = new Gio.ListStore({ item_type: Gtk.FileFilter });
    filterlist.append(fileFilter1);
    filterlist.append(fileFilter2);
    fileDialog.set_filters(filterlist);

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

            // Default to CSV suffix if none chosen
            const basename = file.get_basename();
            if (basename.split(".").length < 2) {
              logpath += ".csv";
            }

            this._settings.set_string("log", logpath);


            this.savedialog();
          }
        }
      } catch(_) {
        // user closed the dialog without selecting any file
        if (insist) {
          // Don't let them get away without creating a log of some kind
          this.firstusedialog();
        }
      }
    });
  }

  async savedialog() {
    if (entries.length > 0) {
      const dialog = new Adw.AlertDialog({
        heading: "Save or New?",
        body: "You currently have time entries in your log. Do you want to save " +
        "those entries to the new log file, or do you want to start over, without any entries?",
        close_response: "save"
      });
      dialog.add_response("new", "Start Over");
      dialog.add_response("save", "Save My Data");
      dialog.connect("response", (_, response_id) => {
        if (response_id === "new") {
          this.writetofile(logpath, "");
        } else {
          this.writelog();
        }
      });
      dialog.present(this);
    } else {
      this.writelog();
    }
    // Set up sync timer
    this.setsynctimer();
  }

  setsynctimer() {
    tick = 0;
    nexttick = 300000 / sync_interval; // The next time to check for daily activities (5 min from now)
    sync_timer = setInterval(() => this.sync(), sync_interval);
    console.log("Syncing has been initiated.");
  }

  resetsynctimer() {
    sync_timer = setInterval(() => this.sync(), sync_interval);
  }

  // Present a dialog for opening an existing log file
  // insist is whether the openlog should insist on returning a file
  async openlog(insist = false) {
    console.log("Opening existing log file");   // Create a new file selection dialog
    const fileDialog = new Gtk.FileDialog();

    // Add filters
    const fileFilter1 = new Gtk.FileFilter();
    fileFilter1.add_suffix("csv");
    fileFilter1.set_name("Comma-Separated Values");
    const fileFilter2 = new Gtk.FileFilter();
    fileFilter2.add_pattern("*");
    fileFilter2.set_name("All Files");
    const filterlist = new Gio.ListStore({ item_type: Gtk.FileFilter });
    filterlist.append(fileFilter1);
    filterlist.append(fileFilter2);
    fileDialog.set_filters(filterlist);

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
            sync_firsttime = true; // Make sure it resets everything
            this.readfromfile();
            this._settings.set_string("log", logpath);
          }
        }
      } catch(_) {
         // user closed the dialog without selecting any file
        if (insist) {
          // Don't let them get away without creating a log of some kind
          this.firstusedialog();
        }
      }
    });
  }

  // Convert the log array into CSV format
  async writelog(filepath = logpath, mainlog = true) {
    let entriesString = "Project,Start Time,End Time,ID";

    for (let i = 0; i < entries.length; i++) {
      let project = "";
      let start = "";
      let end = "";
      let ID = 0;
      try {
         project = entries[i].project;
         start = entries[i].start;
         end = entries[i].end;
         ID = entries[i].ID;
      } catch (_) {
        // Something was empty
      }
      entriesString += '\n' + project + "," + start + "," + end + "," + ID.toString();
    }

    if (sync_extraentries.length > 0) {
      for (let i = 0; i < sync_extraentries.length; i++) {
        let ID = sync_extraentries[i];
        entriesString += '\n,deleted,,' + ID.toString();
      }
    }

    this.writetofile(filepath, entriesString, mainlog);
  }

  // Write the given text to the log file
  async writetofile(filepath, text, mainlog = true) {
    const file = Gio.File.new_for_path(filepath);
    console.log("Attempting to write to " + filepath);
    //text = "Testing this.";
    try {
      sync_operation = 2;
      // Alert self that the next change should not be monitored
      //changemadebyself = true;
      // Save the file (asynchronously)
      let contentsBytes = new GLib.Bytes(text)
      await file.replace_contents_bytes_async(
        contentsBytes,
        null,
        false,
        Gio.FileCreateFlags.REPLACE_DESTINATION,
        null);
      sync_operation = 0;
      if (mainlog) {
        //sync_memory = contentsBytes;
        this._toast_overlay.add_toast(Adw.Toast.new(`Saved to file ${filepath}`));
      }
    } catch(e) {
      sync_operation = 0;
      logError(`Unable to save to ${filepath}: ${e.message}`);
      if (mainlog) {
        this._toast_overlay.add_toast(Adw.Toast.new(`Failed to save to file ${filepath}`));
      }
    }
  }

  // Remove the given entry from the entries array and the log control
  async removeentry(number, writeout = true) {
    if (number == currentTimer) {
      this.stopTimer();
    }
    // Add it to the extraentries so that it isn't considered simply dropped
    sync_extraentries.push(entries[number].ID);

    // Note the change in the sync_change array
    sync_changes.push({
      change: "delete",
      ID:entries[number].ID,
      oldproject: entries[number].project,
      oldstart: entries[number].start,
      oldend: entries[number].end
    });

    this.logmodel.remove(entries.length - 1 - number);
    entries.splice(number, 1);
    changestobemade = writeout;
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
      changestobemade = true;
    }
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

    dialog.add_response("cancel", "Cancel");
    if (number > -1) {
      startDate = entries[number].start;
      endDate = entries[number].end;
      dialog.heading = "Edit Entry";
      dialog.add_response("delete", "Delete");
      dialog.set_response_appearance("delete", Adw.ResponseAppearance.DESTRUCTIVE);
    }
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
      } else {
        endb.label = "Still Logging\nNo date or time yet."
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
          if (currentTimer == number && endDate == null) {
            startedTime = startDate; // Update the currently running entry
          }
        } else {
          this.editentrydialog(
            number,
            "Your response was invalid. Reason: " + validated,
          );
        }
      } else if (response_id === "delete") {
        this.removeentry(number);
        this._toast_overlay.add_toast(Adw.Toast.new("The entry was deleted."));
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
  async editentry(number, theproject, startDate, endDate, writeout = true) {
    // Stop the timer if the entry didn't have an end date, but does now
    if (entries[number].end == null && endDate != null) {
      this.stopTimer();
    }
    // Note the change in the sync_change array
    sync_changes.push({
      change: "edit",
      project: theproject,
      start: startDate,
      end: endDate,
      ID: entries[number].ID,
      oldproject: entries[number].project,
      oldstart: entries[number].start,
      oldend: entries[number].end
    });
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
    this.logmodel.splice(entries.length - 1 - number, 1, [new_item]);
    changestobemade = writeout;
  }

  // Add the given entry to the entries array and the log control
  async addentry(theproject, startDate, endDate = null, writeout = true, ID = 0) {
    const now = new Date();
    if (ID == 0) {
      ID = now.getTime();
    }

    // Note the change in the sync_change array
    sync_changes.push({
      change: "add",
      project: theproject,
      start: startDate,
      end: endDate,
      ID: ID
    });

    entries.push({ start: startDate, end: endDate, project: theproject, ID: ID });

    let new_item = "";
    if (endDate === null && !logging) {
      new_item = "[logging] | Project: " + theproject;
      this.logmodel.splice(0, 0, [new_item]);
      this.startTimer(entries.length - 1, startDate);
    } else {
      new_item =
        this.calcTimeDifference(startDate, endDate) + " | Project: " + theproject;
      this.logmodel.splice(0, 0, [new_item]);
      this.updatetotals();
    }

    changestobemade = writeout;
  }

  // Something to do with searching the log control
  createItemForFilterModel(listItem) {
    const listRow = new Adw.ActionRow({
      title: listItem.string,
    });
    return listRow;
  }

  // Replace the current projects with the given projects in the array.
  // If a project was selected already, try to select that same project when the projectlist reloads.
  async setprojects(projectArray = []) {
    const selection = this._projectlist.get_selected();
    let theproject = "";
    if (selection) {
      theproject = projects[selection];
    }
    model.splice(0, projects.length, [new project({ value: "(no project)" })]);
    projects = ["(no project)"];
    if (projectArray.length > 0) {

      this.addprojects(projectArray);

      if (theproject != "") {
        let projectindex = projects.indexOf(theproject);

        if (projectindex !== -1) {
          nochange = true; // There wasn't actually a change, so don't do anything when the selected-item event is called
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

    console.log("Is timer on? " + logging.toString());
    if (logging) {
      this.stoprunningentry(currentDate);
    } else {
      const selection = this._projectlist.get_selected();
      const selectionText = projects[selection];
      this.addentry(selectionText, currentDate);
    }
  }

  // When the timer needs to be stopped, stop it
  async stopTimer() {
    logging = false;
    clearInterval(timer);
    currentTimer = -1;
    this._startbutton.label = "Start";
    let style = this._startbutton.get_style_context();
    if (style.has_class("destructive-action")) {
      style.remove_class("destructive-action");
    }
    style.add_class("suggested-action");
    this.setTimerText();

    try {
      this._projectlist.set_selected(0); // Reset project to (no project)
    } catch (error) {
      console.log(error);
    }
    console.log("Timer has been stopped.");
  }

  // When called, set the value for the timer to the correct value
  async setTimerText() {
    if (logging) {
      const currentDate = new Date();
      this._status.label = this.calcTimeDifference(startedTime, currentDate);
    } else {
      this._status.label = "00:00:00";
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
  async startTimer(number, startDate) {
    logging = true;
    this._startbutton.label = "Stop";
    let style = this._startbutton.get_style_context();
    if (style.has_class("suggested-action")) {
      style.remove_class("suggested-action");
    }
    style.add_class("destructive-action");
    startedTime = startDate;
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
    this._todaylabel.label = this.createtotals(first, last);

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
    this._thisweeklabel.label = this.createtotals(firstDay, today);
    this._lastweeklabel.label = this.createtotals(firstLast, lastLast);
    //this._customlabel.label = totalString

    this._customlabel.label = this.createtotals(customstart, customend);
  }

  // Find the total time between two dates, and output it by project
  // Should make it possible to output the total too {{{
  createtotals(startDate, endDate) {
    let totals = [{project: "Total", total: 0}];

    // Is there a better way to do this?
    for (const entry of entries) {
      let start = entry.start;
      let end = entry.end;

      if (end && !isNaN(end) && start && !isNaN(start) && start < endDate && end > startDate) {
        if (start < startDate) {
          start = startDate;
        }
        if (end > endDate) {
          end = endDate;
        }
        let sum = end.getTime() - start.getTime(); // Time difference in milliseconds
        sum = Math.floor(sum / 1000);

        totals[0].total += sum;

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
        resultString += "\n";
      }
    }

    return resultString;
  }

  async datedialog(date = new Date(), tocall = null, body = "", ampm = ampmformat) {
    if (!date || isNaN(date)) {
      date = new Date();
    }

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
    const topbox = new Gtk.Box({
      orientation: 0,
      spacing: 6,
    });
    box.append(topbox);
    const bottombox = new Gtk.Box({
      orientation: 1,
      spacing: 6,
    });
    box.append(bottombox);
    const buttonbox = new Gtk.Box({
      orientation: 1,
      spacing: 12,
      valign: 3,
    });
    //const s1 = new Gtk.Separator();
    //box.append(s1);
    const datebox = new Gtk.Box({
      orientation: 0,
      valign: 3,
      spacing: 0,
    });
    topbox.append(datebox);
    //const s2 = new Gtk.Separator();
    //box.append(s2);
    /*
    const monthbox = new Gtk.Box({
      orientation: 1,
      valign: 3,
      spacing: 3,
    });
    datebox.append(monthbox);
    */
    const timebox = new Gtk.Box({
      orientation: 0,
      spacing: 0,
    });
    const monthlist = new Gtk.DropDown({
      enable_search: true,
      width_request: 120
    });
    const dayspin = new Gtk.SpinButton({
      orientation: 1,
      width_request: 35
    });
    const yearspin = new Gtk.SpinButton({
      orientation: 1,
      width_request: 60
    });
    const hourminuteentry = new Gtk.Entry();
    const hourminutelabel = new Gtk.Label();
    const secondentry = new Gtk.Entry();
    const secondlabel = new Gtk.Label();
    const todaybutton = new Gtk.Button();
    const yesterdaybutton = new Gtk.Button();

    const am = new Gtk.ToggleButton;
    const pm = new Gtk.ToggleButton;
    let timestyle = timebox.get_style_context();
    timestyle.add_class("linked");
    let datestyle = datebox.get_style_context();
    datestyle.add_class("linked");

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
      } else if (inputhour == 12) {
        pm.set_active(true);
      } else if (inputhour == 0) {
        inputhour = 12;
        am.set_active(true);
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

    hourminutelabel.label = "Enter hours & minutes with no separator (\"1130\")";
    //secondlabel.label = "Seconds";

    buttonbox.append(yesterdaybutton);
    buttonbox.append(todaybutton);
    //monthbox.append(monthlabel);
    datebox.append(monthlist);
    topbox.append(buttonbox);
    datebox.append(dayspin);
    datebox.append(yearspin);
    //hmbox.append(hourminutelabel);
    timebox.append(hourminuteentry);
    //secondbox.append(secondlabel);
    timebox.append(secondentry);
    bottombox.append(hourminutelabel);
    bottombox.append(timebox);
    if (ampm) {
      timebox.append(am);
      timebox.append(pm);
      am.label = "AM";
      pm.label = "PM";
      const ampmseparator = new Gtk.Separator();
      //box.append(ampmseparator);
      //box.append(ampmbox);
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
        if (ampm) {
          if (pm.get_active() && hour > 0 && hour < 12) {
            chosendate.setHours(chosendate.getHours() + 12);
          } else if (am.get_active() && hour == 12) {
            chosendate.setHours(0);
          }
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

  /* No longer needed, since Time Tracker is using its own file monitor
  async startmonitor() {
    const file = Gio.File.new_for_path(logpath);
    fileMonitor = file.monitor(Gio.FileMonitorFlags.WATCH_HARD_LINKS, null);
    console.log("Starting to watch " + logpath);

    fileMonitor.connect('changed', (_fileMonitor, thefile, _, eventType) => {
      if (eventType == 1) {
        console.log("Change detected in file " + thefile.get_path());
        // Check to see if an actual change was made, or if this is being fired due to an action by self
        if (changemadebyself) {
          changemadebyself = false;
        } else {
          this.readfromfile();
        }
      }
    });

  }
  */

  // Replace all entries by importing an array of time entries
  async setentries(readentries) {
    let change = false;
    let projectsfromlog = [];

    if (sync_firsttime) {
      try {
        change = true;
        sync_firsttime = false;
        if (logging) {
          this.stopTimer();
        }

        // Preparing to see if there's a currently running entry, and get all the projects
        let latestStartDate = null;
        let latestStartIndex = -1;
        let latestStartProject = "";

        // The variable to be written to the visible log
        let new_items = [];
        let modelLength = entries.length;
        entries = []; // Empty entries array
        sync_extraentries = []; // Empty deleted entries array
        for (let i = 0; i < readentries.length; i++) {
          let entry = readentries[i];
          if (!isNaN(entry.start)) {
            let new_item = "";
            if (entry.project == "") {
              entry.project = "(no project)";
            }
            entries.push(entry);
            if (entry.end === null) {
              new_item = "[logging] | Project: " + entry.project;
              new_items.unshift(new_item);

              if (latestStartDate === null || entry.start > latestStartDate) {
                latestStartDate = entry.start;
                latestStartIndex = i;
                latestStartProject = entry.project;
              }
            } else {
              new_item =
                this.calcTimeDifference(entry.start, entry.end) + " | Project: " + entry.project;
              new_items.unshift(new_item);
            }

            if (addprojectsfromlog) {
              if (projects.indexOf(entry.project) == -1 && projectsfromlog.indexOf(entry.project) == -1) {
                projectsfromlog.push(entry.project);
              }
            }
          } else {
            sync_extraentries.push(entry.ID);
          }
        }
        this.logmodel.splice(0, modelLength, new_items);
        //entries = readentries;

        // Start timer
        if (latestStartIndex > -1) {
          this.startTimer(latestStartIndex, latestStartDate);
        }
        // Start sync timer
        this.setsynctimer();
        // Start monitor
        //this.startmonitor();
      } catch (e) {
        console.log(e);
      }
    } else {
      for (let i = 0; i < readentries.length; i++) {
        const entry = readentries[i];
        const foundItem = entries.find(item => item.ID === entry.ID);
        if (foundItem) {
          let spot = entries.indexOf(foundItem);
          // This was an existing entry

          // Create a buffer between the actual dates and checking them, to keep from trying to convert a null value to string
          let s1 = "";
          let s2 = "";
          let e1 = "";
          let e2 = "";
          if (entry.start) {
            s1 = entry.start.toString()
          }
          if (entries[spot].start) {
            s2 = entries[spot].start.toString()
          }
          if (entry.end) {
            e1 = entry.end.toString()
          }
          if (entries[spot].end) {
            e2 = entries[spot].end.toString()
          }

          if (entry.project != entries[spot].project || s1 != s2 || e1 != e2) {
            change = true;
            if (!isNaN(entry.start)) { // May not be needed?
              console.log("Editing " + spot);
              this.editentry(spot, entry.project, entry.start, entry.end, false);
            } else {
              console.log("Removing " + spot);
              this.removeentry(spot, false);
            }

            if (addprojectsfromlog) {
              if (projects.indexOf(entry.project) == -1 && projectsfromlog.indexOf(entry.project) == -1) {
                projectsfromlog.push(entry.project);
              }
            }
          } else {
            //console.log("No need to edit " + spot);
          }
        } else {
          if (!isNaN(entry.start)) {
            // This was an added entry
            change = true;
            console.log("Adding");
            this.addentry(entry.project, entry.start, entry.end, false, entry.ID);

            if (addprojectsfromlog) {
              if (projects.indexOf(entry.project) == -1 && projectsfromlog.indexOf(entry.project) == -1) {
                projectsfromlog.push(entry.project);
              }
            }
          } else {
            //console.log("Skipping a delete line");
          }
        }
      }
      // Perform QC check to see if anything was deleted entirely
      for (let i = 0; i < entries.length; i++) {
        const foundItem = entries.find(item => item.ID === entries[i].ID);
        if (!foundItem) {
          console.log("Deletion occurred without warning: " + entries[i]);
          this.removeentry(i, false);
        }
      }
    }
    if (change) {
      try {
        // Add any newfound projects
        if (addprojectsfromlog && projectsfromlog.length > 0) {
          this.addprojects(projectsfromlog);

          let projectString = "";
          for (let i = 1; i < projects.length - 1; i++) {
            projectString += projects[i] + "`";
          }
          projectString += projects[projects.length - 1];
          this._settings.set_string("projects", projectString);
        }

        // Find out what project the current entry has, and set projectlist to match
        if (currentTimer > -1) {
          let proj = entries[currentTimer].project;
          if (proj != "(no project)") {
            let projectindex = projects.indexOf(proj);
            if (projectindex !== -1) {
              nochange = true;
              this._projectlist.set_selected(projectindex);
            }
          }
        }
      } catch (e) {
        console.log(e);
      }
      this.updatetotals();
    } else {
      //console.log("No change needed");
    }
  }

  // Take a given string and convert it to an array that can be imported into time entries
  async readlog(text) {
    let projectColumn = 0;
    let startColumn = 1;
    let endColumn = 2;
    let idColumn = 3;

    let readentries = [];

    let lines = text.split('\n');
    if (lines.length > 1) {
      for (let i = 1; i < lines.length; i++) {
        let strings = lines[i].split(',');
        if (strings.length > 2) {
          let endvalue = new Date(strings[endColumn]);
          if (isNaN(endvalue)) {
            endvalue = null;
          }
          let projvalue = strings[projectColumn];
          let startvalue = new Date(strings[startColumn]);
          // Clean deleted entries by passing them over in reading the entries

          readentries.push({
            start: new Date(strings[startColumn]),
            end: endvalue,
            project: projvalue,
            ID: parseInt(strings[idColumn])
          });

        }
      }
      this.setentries(readentries);
    }
  }
/*
  async sync_readlog(text) {
    if (sync_operation == 0 || )
  }
*/
  // Read text from a file and serve it to function that converts it into the application's entry format
  async readfromfile(thepath = logpath) {
    if (sync_operation == 0 || Math.floor(sync_operation / 2) != sync_operation / 2) {
      const file = Gio.File.new_for_path(thepath);
      let contentsBytes;
      try {
        contentsBytes = (await file.load_contents_async(null))[0];
      } catch (e) {
        console.log(e, `Unable to open ${file.peek_path()}`);
        return;
      }
      //sync_memory = contentsBytes;
      try {
        if (!GLib.utf8_validate(contentsBytes)) {
          console.log(`Invalid text encoding for ${file.peek_path()}`);
          return;
        }
      } catch (error) {
        //console.log("validate failed: " + error);
      }

      // Convert a UTF-8 bytes array into a String
      const contentsText = new TextDecoder('utf-8').decode(contentsBytes);

      this.readlog(contentsText);
    }
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
    dialog.add_response("cancel", "Close App");
    dialog.set_response_appearance("cancel", Adw.ResponseAppearance.DESTRUCTIVE);

    dialog.connect("response", async (_, response_id) => {
      if (response_id === "cancel") {
        this.close();
      } else if (response_id === "option2") {
        this.newlog(true);
      } else if (response_id === "option3") {
        this.openlog(true);
      } else {
        // system folder
        this.usesystemfolder();
      }
    });

    dialog.present(this);
  }

  async usesystemfolder() {
    const filepath = GLib.build_filenamev([GLib.get_home_dir(), '.local/share/time-tracker']);
    const directory = Gio.File.new_for_path(filepath);
    let success = false;
    if (!directory.query_exists(null)) {
      success = await directory.make_directory_async(GLib.PRIORITY_DEFAULT, null);
    }
    console.log("Tried to write directory " + filepath + ". Success? " + success);
    logpath = filepath + "/log.csv";
    this._settings.set_string("log", logpath);
    // Need to check if file exists
    const file = Gio.File.new_for_path(logpath);
    if (file.query_exists(null)) {
      this.readfromfile();
    } else {
      this.writelog();
    }
    // Set up sync timer
    this.setsynctimer();
  }

  async runbackups(deleteold = true) {
    console.log("Trying to do a backup");
    try {
      const filepath = GLib.build_filenamev([GLib.get_home_dir(), '.local/share/time-tracker']);
      const directory = Gio.File.new_for_path(filepath);
      if (!directory.query_exists(null)) {
        success = await directory.make_directory_async(GLib.PRIORITY_DEFAULT, null);
      } else {
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

        if (todaysbackup == -1) {
          // Run backup
          this.writelog(filepath + "/" + todaysname, false);
          console.log("Saved a backup for today");
          files.push(todaysname);
        } else {
          console.log("No backup needed");
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
      }
    } catch (e) {
      console.log("Tried to save backup, but failed: " + e);
    }
  }

  async preferencesdialog() {
    const dialog = new Adw.AlertDialog({
      heading: "Preferences",
      close_response: "cancel",
    });
    dialog.add_response("cancel", "Done");

    const box = new Gtk.Box({
      orientation: 1,
      spacing: 6,
    });
    const weeklist = new Gtk.DropDown({
      enable_search: true,
    });
    box.append(weeklist);

    // Set the weeklist contents
    weeklist.expression = weekexpression;
    weeklist.model = weekmodel;
    weeklist.set_selected(firstdayofweek);
    weeklist.connect("notify::selected-item", () => {
      firstdayofweek = weeklist.get_selected();
      this._settings.set_int("firstdayofweek", firstdayofweek);
      this.updatetotals();
    });

    const group1 = new Adw.PreferencesGroup();
    group1.set_title("Import Projects from Log");
    group1.set_description("When opening a new log file, add its project names to the list of available projects.");
    const project_switch = new Adw.SwitchRow();
    group1.add(project_switch);
    box.append(group1);
    project_switch.set_active(addprojectsfromlog);
    project_switch.connect("notify::active", () => {
      addprojectsfromlog = project_switch.get_active();
      this._settings.set_boolean("addprojectsfromlog", addprojectsfromlog);
    });

    const group2 = new Adw.PreferencesGroup();
    group2.set_title("12-Hour Format");
    group2.set_description("Should Time Tracker use 12-hour time format (AM/PM), instead of 24-hour time format?");
    const time_switch = new Adw.SwitchRow();
    group2.add(time_switch);
    box.append(group2);
    time_switch.set_active(ampmformat);
    time_switch.connect("notify::active", () => {
      ampmformat = time_switch.get_active();
      this._settings.set_boolean("ampmformat", ampmformat);
    });

    let loglabel = new Gtk.Label();

    const sysbutton = new Gtk.Button();
    sysbutton.label = "Store Logs in App's System Folder";
    sysbutton.connect("clicked", () => {
      this.usesystemfolder();
      this.savedialog();
      loglabel.label = "Now storing logs in app's system folder.";
    });
    box.append(sysbutton);
    box.append(loglabel);

    dialog.set_extra_child(box);
    dialog.present(this);
  }
});
