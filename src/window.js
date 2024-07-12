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
Gio._promisify(Gio.File.prototype,
    'create_async',
    'create_finish');

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
let currentTimer = null;
let changestobemade = false;
let ampmformat = true;
let nochange = false;
let sync_interval = 1000;
let tick = 0;
let nexttick = 0;
let customfilter = -1;
let customstart = null;
let customend = null;
let customproject = null;
let custombilled = null;
let customtag = null;
let customclient = null;
let customgroup = 0;
let sync_operation = 0; // Is a current operation trying to sync?
let sync_changes = []; // Changes to be synced
// type, project, start, stop, ID, oldproject, oldstart, oldstop, undone
let sync_extraentries = []; // Entries not to be read into entries array, but to be written to the log file
let sync_firsttime = true;
let sync_templogpath = "";
let sync_autotemplog = false;
let sync_fullstop = false;
let sync_templog = false;
let sync_extracolumns = [];
let filters = [];

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
  'list_box_editable', 'add', 'report1', 'report2', 'report3', 'toast_overlay',
  'customreport', 'reportstart', 'reportend', 'reportproject', 'reportbilled',
  'reportgroup', 'reporttag', 'reportclient', 'metaentry',
  'next_button', 'nav_pageone', 'nav_pagetwo', 'nav_pagethree',
  'nav_pagefour', 'nav_view', 'next_button', 'previous_button', 'nav_title'],
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
    sync_autotemplog = this._settings.get_boolean("autotemplog");
    logpath = this._settings.get_string("log");
    const projectsSetting = this._settings.get_string("projects");
    try {
      this.setprojects(projectsSetting.split("`"));
    } catch (_) {
      this.setprojects();
    }

    // Navigation view
    this._next_button.connect("clicked", () => {
      switch (this._nav_view.visible_page) {
        case this._nav_pageone:
          this._nav_view.push(this._nav_pagetwo);
          break;
        case this._nav_pagetwo:
          this._nav_view.push(this._nav_pagethree);
          break;
        case this._nav_pagethree:
          this._nav_view.push(this._nav_pagefour);
          break;
      }
    });
    this._previous_button.connect("clicked", () => {
      this._nav_view.pop();
    });
    this._nav_view.connect("notify::visible-page", () => {
      this._previous_button.sensitive = this._nav_view.visible_page !== this._nav_pageone;
      this._next_button.sensitive = this._nav_view.visible_page !== this._nav_pagefour;
      this._nav_title.label = this._nav_view.visible_page.title;
    });

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

    // Connecting the "Edit Projects" button with the proper function
    const projectsAction = new Gio.SimpleAction({name: 'projects'});
    projectsAction.connect('activate', () => this.editprojectdialog());
    this.add_action(projectsAction);

    // Connecting the "Import Log" button with the proper function
    const importAction = new Gio.SimpleAction({name: 'import'});
    importAction.connect('activate', () => this.importlog());
    this.add_action(importAction);

    // Connecting the "Undo" button with the proper function
    const undoAction = new Gio.SimpleAction({name: 'undo'});
    undoAction.connect('activate', () => this.undo());
    this.add_action(undoAction);

    // Connecting the "Redo" button with the proper function
    const redoAction = new Gio.SimpleAction({name: 'redo'});
    redoAction.connect('activate', () => this.redo());
    this.add_action(redoAction);

    // Connecting the project model to projectlist
    this._projectlist.expression = listexpression;
    this._projectlist.model = model;

    // Connecting a change of selections in projectlist with the proper function
    this._projectlist.connect("notify::selected-item", () => {
      const selection = this._projectlist.selected_item;
      // When the selected project changes, change the project in the currently running entry, if any
      if (!nochange && selection && logging) {
        const value = selection.value;
        this.editrunningentrybyIndex(value, entries[this.currentTimer()].meta);
      }
    });

    this._metaentry.connect("changed", () => {
      if (!nochange && logging) {
        if (this._metaentry.get_text() != "") {
          this.editrunningentrybyIndex(entries[this.currentTimer()].project, this._metaentry.get_text());
        } else {
          this.editrunningentrybyIndex(entries[this.currentTimer()].project, null);
        }
      }
    });

    // Defining the model for the log
    this.logmodel = new Gtk.StringList();

    // Defining the searching and filtering model
    // {{{ some of this code can be removed
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
        if (date) {
          this._reportstart.label = this.datetotext(date);
        } else {
          this._reportstart.label = "Start Time";
        }
        this.displaycustomfilter();
      }, null, true);
    });

    this._reportend.connect("clicked", () => {
      this.datedialog(customend, (date) => {
        customend = date;
        if (date) {
          this._reportend.label = this.datetotext(date);
        } else {
          this._reportend.label = "End Time";
        }
        this.displaycustomfilter();
      }, null, true);
    });

    this._reportproject.connect("clicked", () => {
      this.projectdialog(customproject, (theproject) => {
        customproject = theproject;
        if (theproject) {
          this._reportproject.label = theproject;
        } else {
          this._reportproject.label = "Project";
        }
        this.displaycustomfilter();
      }, "<All Projects>");
    });

    this._reportbilled.connect("clicked", () => {
      this.billeddialog(custombilled, (billed) => {
        custombilled = billed;
        if (billed) {
          this._reportbilled.label = "Billed: Yes";
        } else if (billed == false) {
          this._reportbilled.label = "Billed: No";
        } else {
          this._reportbilled.label = "Billed Status";
        }
        this.displaycustomfilter();
      }, "Both Billed and Not Billed");
    });

    this._reportgroup.connect("clicked", () => {
      this.groupdialog(customgroup, (groupby) => {
        customgroup = groupby;
        if (groupby == 1) {
          this._reportgroup.label = "Group by Project";
        } else if (groupby == 2) {
          this._reportgroup.label = "Group by Billed";
        } else {
          this._reportgroup.label = "Grouping";
        }
        this.displaycustomfilter();
      });
    });

    /* Connecting the search entry with searching the log
    this._search_entry.connect("search-changed", () => {
      const searchText = this._search_entry.get_text();
      filter.search = searchText;
    });
    */

    this._reporttag.connect("changed", () => {
      if (this._reporttag.get_text() != "") {
        customtag = this._reporttag.get_text();
      } else {
        customtag = null;
      }
      this.displaycustomfilter();
    });

    this._reportclient.connect("changed", () => {
      if (this._reportclient.get_text() != "") {
        customclient = this._reportclient.get_text();
      } else {
        customclient = null;
      }
      this.displaycustomfilter();
    });

    // Opening edit/delete dialog when a log row is selected
    this._list_box_editable.connect("row-selected", () => {
      const selectedRow = this._list_box_editable.get_selected_row();
      if (selectedRow) {
        const index = selectedRow.get_index();
        this._list_box_editable.unselect_all();
        this.editentrydialog(entries.length - 1 - index);
      }
    });

    // Connecting the preferences button with the proper function
    const prefsAction = new Gio.SimpleAction({name: 'preferences'});
    prefsAction.connect('activate', async () => {
      this.preferencesdialog();
    });
    this.add_action(prefsAction);

    // Autosaving before close
    this.closehandler = this.connect("close-request", async () => {
      try {
        // Make it possible to close the window by disconnecting the closehandler
        this.disconnect(this.closehandler);
        // Sync any last-minute changes
        if (changestobemade) {
          changestobemade = false;
          await this.writelog();
        }
        setInterval(() => {this.close()}, 10); // Call something else that will actually close the window
      } catch (e) {
        console.log(e);
      }
    });

    // Check if there's a user-selected log file, and load it; otherwise, prompt the user to create one
    if (logpath == "") {
      this.firstusedialog();
    } else {
      const file = Gio.File.new_for_path(logpath);
      if (file.query_exists(null)) {
        this.readfromfile_sync();
      } else {
        if (sync_autotemplog) {
          this.settempfile();
        } else {
          this.filenotfounddialog(logpath);
        }
      }
    }

    // All done constructing the window!
  }

  async undo() {
    //console.log(sync_changes);
    try {
      // Find last undefined or false .undone in sync_changes
      if (sync_changes.length > 0) {
        for (let i = sync_changes.length - 1; i > -1; i--) {
          //console.log(sync_changes[i].undone);
          if (!sync_changes[i].undone) {
            console.log("Undoing");
            let change = sync_changes[i];
            //console.log(change);
            // Undo that item
            if (change.change == "delete" || change.change == "edit") {
              //console.log("editing");
              this.editentrybyID(change.ID, change.oldproject, change.oldstart, change.oldend, change.oldbilled, change.oldmeta);
            } else {
              //console.log("deleting");
              // Change was an addition
              this.removeentrybyID(change.ID);
            }
            // Set that item as .undone = true
            sync_changes[i].undone = true;

            if (logging) {
              this.setprojectandmeta(entries[this.currentTimer()].project, entries[this.currentTimer()].meta);
            }
            break;
          }
        }
      }
    } catch (e) {
      console.log(e);
    }
  }

  async redo() {
    try {
      // Find .undone = true item immediately following last undefined or false .undone in sync_changes
      if (sync_changes.length > 0) {
        for (let i = sync_changes.length - 1; i > -1; i--) {
          if ((!sync_changes[i].undone && i < sync_changes.length - 1) || (sync_changes[i].undone && i == 0)) {
            console.log("Redoing");
            let j = i;
            if (!sync_changes[i].undone) {
              j += 1;
            }
            let change = sync_changes[j];
            // Redo j
            if (change.change == "add" || change.change == "edit") {
              this.editentrybyID(change.ID, change.project, change.start, change.end, change.billed, change.meta);
            } else {
              this.removeentrybyID(change.ID);
            }
            // Set that item as .undone = false
            sync_changes[j].undone = false;

            if (logging) {
              this.setprojectandmeta(entries[this.currentTimer()].project, entries[this.currentTimer()].meta);
            }
            break;
          }
        }
      }
    } catch (e) {
      console.log(e);
    }
  }

  async readfromfile_sync() {
    await this.readfromfile();
    // Start sync timer
    this.setsynctimer();
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
    try {
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
      console.log("Sync has detected changes to be made: " + changestobemade);
      changestobemade = false;
      await this.writelog();
    } else {
      // Sync to the file
      await this.readfromfile();
    }

    // Start sync timer
    this.resetsynctimer();
    } catch (e) {
      console.log(e);
    }
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
            this.stopsynctimer()
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
    sync_templog = false;
    if (entries.length > 0) {
      const dialog = new Adw.AlertDialog({
        heading: "Save or New?",
        body: "You currently have time entries in your log. Do you want to save " +
        "those entries to the new log file, or do you want to start over, without any entries?",
        close_response: "save"
      });
      dialog.add_response("new", "Start Over");
      dialog.add_response("save", "Save My Data");
      dialog.connect("response", async (_, response_id) => {
        if (response_id === "new") {
          const file = Gio.File.new_for_path(logpath);

          // If the file exists
          if (file.query_exists(null)) {
            await this.createfile(logpath);
          } else {
            await this.writetofile(logpath, "Project,Start,End,ID");
          }
          sync_firsttime = true;
          // Empty sync_extracolumns
          sync_extracolumns = [];
          await this.setentries([]);
        } else {
          await this.createfile(logpath);
          await this.writelog();
        }
        // Set up sync timer
        this.setsynctimer();
      });
      dialog.present(this);
    } else {
      await this.createfile(logpath);
      await this.writelog();
      // Set up sync timer
      this.setsynctimer();
    }
  }

  // This should be called whenever a new file is opened
  setsynctimer() {
    sync_fullstop = false;
    if (sync_timer !== null) {
      clearInterval(sync_timer);
    }
    sync_firsttime = false;
    tick = 0;
    nexttick = 300000 / sync_interval; // The next time to check for daily activities (5 min from now)
    sync_timer = setInterval(() => this.sync(), sync_interval);
    console.log("Syncing has been initiated.");
  }

  // This should be called whenever a read or write is completed
  resetsynctimer() {
    if (!sync_fullstop) {
      if (sync_timer !== null) {
        clearInterval(sync_timer);
      }
      sync_timer = setInterval(() => this.sync(), sync_interval);
    }
  }

  stopsynctimer() {
    sync_fullstop = true;
    if (sync_timer !== null) {
      clearInterval(sync_timer);
      sync_timer = null;
    }
    console.log("Syncing has been stopped.");
  }

  async importlog() {
    console.log("Importing existing log file");   // Create a new file selection dialog
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
            const errormessage = "You have not given Time Tracker the permission to read/write files in the home directory. Time Tracker cannot run without these permissions. You may want to configure this with FlatSeal.";
            console.log(errormessage);
            this.alert(errormessage);
          } else {
            // Define a dialog that asks whether to keep conflicting entries as they are in current file, or to make changes based on imported file !!!

            this.mergelogs(logpath, file.get_path());
          }
        }
      } catch(_) {
         // user closed the dialog without selecting any file
      }
    });
  }

  // log2 is the log that will be merged into log1, the main log.
  // If keeporiginal = true, the values in log1 will be kept where log2 differs
  async mergelogs(log1, log2, keeporiginal = false) {
    if (log1 != log2) {
      console.log("Merging " + log1 + " and " + log2);

      // Read log2 as new
      // Make sure it resets everything when reading the new file
      sync_firsttime = true;
      // Empty sync_extracolumns
      sync_extracolumns = [];

      if (!keeporiginal) {
        // Read log1 as original
        await this.readfromfile(log1);
        // Read log2 as merge
        await this.readfromfile(log2, true);
      } else {
        // Read log2 as original
        await this.readfromfile(log2);
        // Read log1 as merge
        await this.readfromfile(log1, true);
      }

      // Set logpath to log1 and save
      logpath = log1;
      await this.writelog();
      // Start sync timer
      this.setsynctimer();

    } else {
      console.log("Cannot merge the same file");
    }
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
            const errormessage = "You have not given Time Tracker the permission to read/write files in the home directory. Time Tracker cannot run without these permissions. You may want to configure this with FlatSeal.";
            console.log(errormessage);
            this.alert(errormessage);
          } else {
            this.stopsynctimer()
            logpath = file.get_path();
            // Make sure it resets everything when reading the new file
            sync_firsttime = true;
            // Empty sync_extracolumns
            sync_extracolumns = [];
            sync_templog = false;
            await this.readfromfile();
            // Start sync timer
            this.setsynctimer();
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
  async writelog(filepath = logpath, notify = true) {
    let entriesString = "Project,Start Time,End Time,Description,ID,Duration (Readable),Duration (Seconds),Billed";

    if (sync_extracolumns.length > 0) {
      for (let i = 0; i < sync_extracolumns.length; i++) {
        entriesString += "," + this.addquotes(sync_extracolumns[i]);
      }
    }

    for (let i = 0; i < entries.length; i++) {
      let project = "";
      let start = "";
      let end = "";
      let meta = "";
      let duration = "";
      let seconds = "";
      let ID = 0;
      let billed = false;
      try {
        let startDate = entries[i].start;
        start = startDate.toString();
        let endDate = entries[i].end;
        if (endDate) {
          end = endDate.toString();
          duration = this.calcTimeDifference(startDate, endDate, true).toString();
          seconds = this.calcTimeDifference(startDate, endDate, false).toString();
        } else {
          end = "";
        }
        ID = entries[i].ID;
        project = this.addquotes(entries[i].project);
        if (entries[i].billed == true) {
          billed = true;
        }
        if (entries[i].meta) {
          meta = entries[i].meta;
        }
      } catch (e) {
        console.log(e);
      }
      entriesString += '\n' + project + "," + start + "," + end + "," + meta + "," + ID.toString() + "," + duration + "," + seconds + "," + billed.toString();

      if (sync_extracolumns.length > 0) {
        for (let j = 0; j < sync_extracolumns.length; j++) {
          entriesString += ",";
          if (entries[i][sync_extracolumns[j]]) {
            entriesString += this.addquotes(entries[i][sync_extracolumns[j]]);
          }
        }
      }
    }

    if (sync_extraentries.length > 0) {
      for (let i = 0; i < sync_extraentries.length; i++) {
        let ID = sync_extraentries[i].ID;
        let deletedate = sync_extraentries[i].end;
        entriesString += '\n,deleted,' + deletedate.toString() +',,' + ID.toString() + ",,,";
      }
    }

    const file = Gio.File.new_for_path(filepath);

    // If the file exists
    if (file.query_exists(null)) {
      if (filepath != logpath || !sync_templog) {
        this.writetofile(filepath, entriesString, notify);
      } else if (filepath == logpath && sync_templog) {
        // Now that the log is found again
        await this.prodigal();
      }
    } else {
      // The file does not exist
      await this.lostlog(entriesString);
    }
  }

  // Add quotes appropriately for CSV format
  addquotes(text) {
    if (typeof text === 'string' && (text.includes('"') || text.includes('\n') || text.includes(','))) {
      text = '"' + text.replace(/"/g, '""') + '"';
    }
    return text;
  }

  // Write the given text to the log file
  async writetofile(filepath, text, notify = true) {
    const file = Gio.File.new_for_path(filepath);
    console.log("Writing to " + filepath);
    //console.log("\"" + text + "\"");

    try {
      //sync_operation = 2;
      // Save the file (asynchronously)
      let contentsBytes = new GLib.Bytes(text)
      await file.replace_contents_bytes_async(
        contentsBytes,
        null,
        false,
        Gio.FileCreateFlags.REPLACE_DESTINATION,
        null);
      //sync_operation = 0;
      if (notify) {
        //sync_memory = contentsBytes;
        this._toast_overlay.add_toast(Adw.Toast.new(`Saved to file ${filepath}`));
      }
    } catch (e) {
      //sync_operation = 0;
      logError(`Unable to save to ${filepath}: ${e.message}`);

      if (filepath == logpath) {
        if (notify) {
          this._toast_overlay.add_toast(Adw.Toast.new(`Failed to save to file ${filepath}`));
        }
      }
    }
  }

  // This is used when the system, rather than the user, is removing an entry
  // Therefore, it doesn't affect sync_changes the same way
  async removeentrybyID(ID) {
    //console.log(ID);
    //console.log(entries);
    const foundItem = entries.find(item => item.ID === ID);
    if (foundItem) {
      //console.log(entries.indexOf(foundItem) + " " + foundItem);
      this.removeentrybyIndex(entries.indexOf(foundItem));
    }
  }

  async removeentry_user(number, writeout = true) {
    // Note the change in the sync_change array
    sync_changes.push({
      change: "delete",
      ID:entries[number].ID,
      oldproject: entries[number].project,
      oldstart: entries[number].start,
      oldend: entries[number].end,
      oldbilled: entries[number].billed,
      oldmeta: entries[number].meta,
    });

    this.removeentrybyIndex(number, writeout);
  }

  // Finds the index of the current timer
  currentTimer() {
    let response = null;
    const foundItem = entries.find(item => item.ID === currentTimer);
    if (foundItem) {
      response = entries.indexOf(foundItem);
    }
    return response;
  }

  // Remove the given entry from the entries array and the log control
  async removeentrybyIndex(number, writeout = true) {
    // Add it to the extraentries so that it isn't considered simply dropped
    let del = new Date();
    sync_extraentries.push({ ID: entries[number].ID, end: del });

    if (number == this.currentTimer()) {
      this.stopTimer();
    }

    this.logmodel.remove(entries.length - 1 - number);
    entries.splice(number, 1);

    console.log("removeentrybyIndex() is queuing a change to write out: " + writeout);
    changestobemade = writeout;
    this.updatetotals();
  }

  // Stop the entry currently in the timer with the given end date
  async stoprunningentry(endDate) {
    try {
      let current = this.currentTimer();
      console.log("Current timer is # " + current + ", ID: " + currentTimer);
      if (current != null) { // Set as this rather than if (current), to fix a difference in the way Mint Cinnamon is parsing JS
        this.editentry_user(
          current,
          entries[current].project,
          entries[current].start,
          endDate,
          entries[current].billed,
          entries[current].meta,
        );
        console.log("stoprunningentry() is queuing a change to write out.");
        changestobemade = true;
      }
    } catch (e) {
      console.log(e);
    }
  }

  // Update the project of the currently running entry
  async editrunningentrybyIndex(theproject, meta) {
    let current = this.currentTimer();
    if (current) {
      //Is this code needed? {{{
      if (theproject == "") {
        theproject = entries[current].project;
      }
      this.editentry_user(current, theproject, entries[current].start, null, entries[current].billed, meta);
    }
  }

  // The dialog to be used when a user wishes to add or edit an entry manually.
  // Use no arguments if adding an entry, if editing, give the index number
  async editentrydialog(number = -1, body = "") {
    try {
      let theproject = "";
      let startDate = new Date();
      let endDate = new Date();
      let billed = false;
      let meta = null;

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
        billed = entries[number].billed;
        meta = entries[number].meta;
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
      projectlist2.expression = listexpression;
      projectlist2.model = model;
      box.append(projectlist2);

      const metaentry2 = new Gtk.Entry({
        placeholder_text: "Description  #tag  @client",
      });
      if (meta) {
        metaentry2.set_text(meta);
      }
      box.append(metaentry2);

      const box0 = new Gtk.Box({
        orientation: 0,
        spacing: 12,
      });
      box.append(box0);

      const box1 = new Gtk.Box({
        orientation: 1,
        spacing: 6,
      });
      box0.append(box1);

      const box2 = new Gtk.Box({
        orientation: 1,
        spacing: 6,
      });
      box0.append(box2);

      const startlabel = new Gtk.Label();
      startlabel.label = "Start Time";
      box1.append(startlabel);

      const endlabel = new Gtk.Label();
      endlabel.label = "End Time";
      box2.append(endlabel);

      const startb = new Gtk.Button();
      startb.connect("clicked", () => {
        this.datedialog(startDate, (date) => {
          startDate = date;
          startb.label = this.datetotext(date);
        });
      });
      box1.append(startb);

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
      box2.append(endb);

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

      const billedb = new Gtk.CheckButton({
        active: false,
        label: "This entry has been billed.",
      });
      if (billed == true) {
        billedb.set_active(true);
      }
      box.append(billedb);

      dialog.set_extra_child(box);

      dialog.connect("response", (_, response_id) => {
        if (response_id === "okay") {
          let validated = "";

          if (endDate !== null && startDate > endDate) {
            validated += "End date is earlier than start date.";
          } else if (endDate == null && startDate > new Date()) {
            validated += "Start date is in the future.";
          }

          if (validated == "") {
            const selection = projectlist2.selected_item;
            const value = selection.value;
            if (selection) {
              theproject = value;
              nochange = true;
              this._projectlist.set_selected(projectlist2.get_selected());
              this._metaentry.set_text(metaentry2.get_text());
              nochange = false;
            }
            if (metaentry2.get_text() != "") {
              meta = metaentry2.get_text();
            } else {
              meta = null;
            }
            if (number == -1) {
              console.log("Adding " + theproject + " " + startDate + " " + endDate + " " + billedb.get_active());
              this.addentry_user(theproject, meta, startDate, endDate, billedb.get_active());
            } else {
              console.log("Editing " + number + " " + theproject + " " + startDate + " " + endDate + " " + billedb.get_active());
              this.editentry_user(number, theproject, startDate, endDate, billedb.get_active(), meta);
            }
            if (this.currentTimer() == number && endDate == null) {
              startedTime = startDate; // Update the currently running entry
            }
          } else {
            this.editentrydialog(
              number,
              "Your response was invalid. Reason: " + validated,
            );
          }
        } else if (response_id === "delete") {
          this.removeentry_user(number);
          this._toast_overlay.add_toast(Adw.Toast.new("The entry was deleted."));
        }
      });

      dialog.present(this);
    } catch (e) {
      console.log(e);
    }
  }

  // Present a dialog where the user can edit the projects that show in the projectlist
  async editprojectdialog() {
    const dialog = new Adw.AlertDialog({
      heading: "Edit Projects",
      body: "Separate projects with line breaks. You can include #tags and @clients.",
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

  async editentrybyID(ID, project, start, end, billed, meta) {
    const foundItem = entries.find(item => item.ID === ID);
    //console.log(foundItem);
    if (foundItem) {
      // Edit the entry
      this.editentrybyIndex(entries.indexOf(foundItem), project, start, end, billed, meta);
    } else {
      // Remove the entry from sync_extraentries
      const foundDeletion = sync_extraentries.find(item => item.ID === ID);
      if (foundDeletion) {
        sync_extraentries.splice(sync_extraentries.indexOf(foundDeletion), 1);
      }
      // Recreate the entry
      this.addentry(project, meta, start, end, billed, true, ID);
    }
  }

  findindexbyID(ID) {
    const foundItem = entries.find(item => item.ID === ID);
    return entries.indexOf(foundItem);
  }

  async editentry_user(number, theproject, startDate, endDate, billed, meta, writeout = true) {
    console.log("Noting edit of " + number + " in undo/redo array");

    // Note the change in the sync_change array
    sync_changes.push({
      change: "edit",
      project: theproject,
      start: startDate,
      end: endDate,
      billed: billed,
      meta: meta,
      ID: entries[number].ID,
      oldproject: entries[number].project,
      oldstart: entries[number].start,
      oldend: entries[number].end,
      oldbilled: entries[number].billed,
      oldmeta: entries[number].meta,
    });
    //console.log(sync_changes[sync_changes.length-1]);
    this.editentrybyIndex(number, theproject, startDate, endDate, billed, meta, writeout);
  }

  // Edit the given entry in the entries array and the log control
  async editentrybyIndex(number, theproject, startDate, endDate, billed, meta, writeout = true) {
    console.log("Preparing to edit " + number);
    // Stop the timer if the entry didn't have an end date, but does now
    if (entries[number].end == null && endDate != null) {
      this.stopTimer();
    }
    entries[number].project = theproject;
    entries[number].start = startDate;
    entries[number].end = endDate;
    entries[number].billed = billed;
    entries[number].meta = meta;
    let new_item = "";
    if (endDate === null) {
      if (number == this.currentTimer()) {
        new_item = "[logging] | Project: " + theproject;
        if (meta) {
          new_item += "\n" + meta;
        }
      } else if (!logging) {
        new_item = "[logging] | Project: " + theproject;
        if (meta) {
          new_item += "\n" + meta;
        }
        this.startTimer(number, startDate);
      } else {
        new_item = "[???????] | Project: " + theproject;
        if (meta) {
          new_item += "\n" + meta;
        }
      }
    } else {
      new_item = this.calcTimeDifference(startDate, endDate) + " | Project: " + theproject;
      if (meta) {
        new_item += "\n" + meta;
      }
      this.updatetotals();
    }
    this.logmodel.splice(entries.length - 1 - number, 1, [new_item]);
    console.log("editentrybyIndex() is queuing a change to write out: " + writeout);
    changestobemade = writeout;
  }

  async addentry_user(theproject, meta, startDate, endDate = null, billed = false, writeout = true, ID = 0) {
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
      ID: ID,
      billed: billed,
    });

    this.addentry(theproject, meta, startDate, endDate, billed, writeout, ID)
  }

  // Add the given entry to the entries array and the log control
  async addentry(theproject, meta, startDate, endDate = null, billed = false, writeout = true, ID = 0, index = -1) {
    //console.log(ID);
    const now = new Date();
    if (ID == 0) {
      ID = now.getTime();
    }

    if (index == -1 || index > entries.length) {
      entries.push({ start: startDate, end: endDate, project: theproject, ID: ID, billed: billed, meta: meta });

      let new_item = "";
      if (endDate === null && !logging) {
        new_item = "[logging] | Project: " + theproject;
        if (meta) {
          new_item += "\n" + meta;
        }
        this.logmodel.splice(0, 0, [new_item]);
        this.startTimer(entries.length - 1, startDate);
      } else {
        new_item = this.calcTimeDifference(startDate, endDate) + " | Project: " + theproject;
        if (meta) {
          new_item += "\n" + meta;
        }
        this.logmodel.splice(0, 0, [new_item]);
        this.updatetotals();
      }
    } else {
      entries.splice(index, 0, { start: startDate, end: endDate, project: theproject, ID: ID, billed: billed, meta: meta });

      let new_item = "";
      if (endDate === null && !logging) {
        new_item = "[logging] | Project: " + theproject;
        if (meta) {
          new_item += "\n" + meta;
        }
        this.logmodel.splice(entries.length - 1 - index, 0, [new_item]);
        this.startTimer(entries.length - 1, startDate);
      } else {
        new_item = this.calcTimeDifference(startDate, endDate) + " | Project: " + theproject;
        if (meta) {
          new_item += "\n" + meta;
        }
        this.logmodel.splice(entries.length - 1 - index, 0, [new_item]);
        this.updatetotals();
      }
    }

    console.log("addentry() is queuing a change to write out: " + writeout);
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
    nochange = true; // There wasn't actually a change, so don't do anything when the selected-item event is called
    model.splice(0, projects.length, [new project({ value: "(no project)" })]);
    nochange = false;
    projects = ["(no project)"];
    if (projectArray.length > 0) {

      this.addprojects(projectArray);

      if (theproject != "") {
        let projectindex = projects.indexOf(theproject);

        if (projectindex !== -1) {
          console.log(projectindex);
          nochange = true; // There wasn't actually a change, so don't do anything when the selected-item event is called
          this._projectlist.set_selected(projectindex);
          nochange = false;
        }
      }
    }
  }

  addprojects(projectArray) {
    const len = projects.length;
    for (let i = 0; i < projectArray.length; i++) {
      let proj = projectArray[i].trim();
      if (proj != "") {
        model.splice(i + len, 0, [new project({ value: proj })]);
        projects.push(proj);
      }
    }
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
      let meta = null;
      if (this._metaentry.get_text()) {
        meta = this._metaentry.get_text();
      }
      this.addentry_user(selectionText, meta, currentDate);
    }
  }

  // When the timer needs to be stopped, stop it
  async stopTimer() {
    logging = false;
    clearInterval(timer);
    currentTimer = null;
    this._startbutton.label = "Start";
    let style = this._startbutton.get_style_context();
    if (style.has_class("destructive-action")) {
      style.remove_class("destructive-action");
    }
    style.add_class("suggested-action");
    this.setTimerText();

    try {
      this._projectlist.set_selected(0); // Reset project to (no project)
      this._metaentry.set_text("");
    } catch (error) {
      console.log(error);
    }
    //console.log("Timer has been stopped.");
  }

  // When called, set the value for the timer to the correct value
  async setTimerText() {
    try {
      if (logging) {
        const currentDate = new Date();
        this._status.label = this.calcTimeDifference(startedTime, currentDate);
      } else {
        this._status.label = "00:00:00";
      }
    } catch (e) {
      console.log(e);
    }
  }

  // Calculate the difference between two times. textOutput decides whether it comes in 1h 34m 21s format, or whether it comes in seconds.
  // There's another function somewhere that ought to be going through this one {{{
  calcTimeDifference(startTime, endTime, textOutput = true) {
    const timeDifference = Math.floor((endTime - startTime) / 1000); // Time difference in seconds
    if (textOutput && timeDifference >= 0) {
      return this.secondstoOutput(timeDifference);
    } else {
      return timeDifference;
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
    currentTimer = entries[number].ID;
    console.log("Started entry # " + number + ", ID is " + currentTimer);
    //console.log("Timer has been started.");
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
    try {
      // Find the beginning of today
      let todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      // Find the end of today
      let todayEnd = new Date();
      todayEnd.setHours(23, 59, 59, 999);

      // Find the start of this week
      let thisWeekStart;
      for (let i = 0; i >= -6; i--) {
        let currentDate = new Date();
        currentDate.setDate(todayStart.getDate() + i);
        if (currentDate.getDay() === firstdayofweek) {
          thisWeekStart = currentDate;
          break;
        }
      }
      thisWeekStart.setHours(0, 0, 0, 0);

      // Find the start of last week
      let lastWeekStart = new Date(thisWeekStart);
      lastWeekStart.setDate(thisWeekStart.getDate() - 7); // Get the day one week before thisWeekStart
      lastWeekStart.setHours(0, 0, 0, 0);

      // Find the end of last week
      let lastWeekEnd = new Date(thisWeekStart);
      lastWeekEnd.setDate(thisWeekStart.getDate() - 1);
      lastWeekEnd.setHours(23, 59, 59, 999);

      /*
      this._todaylabel.label = this.createtotals(todayStart, todayEnd);
      this._thisweeklabel.label = this.createtotals(thisWeekStart, todayEnd);
      this._lastweeklabel.label = this.createtotals(lastWeekStart, lastWeekEnd);
      this._customlabel.label = this.createtotals(customstart, customend);
      this._alltimelabel.label = this.createtotals(null, null);
      */

      // Empty filters[]
      if (this._reportsbox1) {
        this._reportsbox1?.unparent();
        this._reportsbox1?.run_dispose();
        filters = [];
      }
      this._reportsbox1 = new Gtk.Box({
        orientation: 1,
        spacing: 12,
      });
      this._report1.append(this._reportsbox1);


      // Empty filters[]
      if (this._reportsbox2) {
        this._reportsbox2?.unparent();
        this._reportsbox2?.run_dispose();
        filters = [];
      }
      this._reportsbox2 = new Gtk.Box({
        orientation: 1,
        spacing: 12,
      });
      this._report2.append(this._reportsbox2);


      // Empty filters[]
      if (this._reportsbox3) {
        this._reportsbox3?.unparent();
        this._reportsbox3?.run_dispose();
        filters = [];
      }
      this._reportsbox3 = new Gtk.Box({
        orientation: 1,
        spacing: 12,
      });
      this._report3.append(this._reportsbox3);


      this.displayfilter(this._reportsbox1, "Today", false, 1, todayStart, todayEnd);
      this.displayfilter(this._reportsbox2, "This Week", false, 1, thisWeekStart, todayEnd);
      this.displayfilter(this._reportsbox3, "Last Week", false, 1, lastWeekStart, lastWeekEnd);

      this.displaycustomfilter();
    } catch (e) {
      console.log(e);
    }
  }

  async displaycustomfilter() {
    try {
      if (this._customreportsbox) {
        this._customreportsbox.unparent();
        this._customreportsbox.run_dispose();
      }
      if (customfilter > -1) {
        filters.splice(customfilter, 1);
        customfilter = -1;
      }
      this._customreportsbox = new Gtk.Box({
        orientation: 1,
      });
      this._customreport.append(this._customreportsbox);
      customfilter = this.displayfilter(this._customreportsbox, null, true, customgroup, customstart, customend, customproject, custombilled, customtag, customclient);
    } catch (e) {
      console.log(e);
    }
  }

  // This function displays a preset group of filters in the Preset area
  // groupby = 0 : no grouping
  // groupby = 1 : project
  // groupby = 2 : billed
  async displayfilter(widget, title = null, usedescription = false, groupby = 0, startDate = null, endDate = null, theproject = null, billed = null, tag = null, client = null) {
    try {
      let outputentries = this.filterentries(startDate, endDate, theproject, billed, tag, client);
      let duration = this.secondstoOutput(outputentries[0].duration);
      let description = "";
      if (startDate && endDate) {
        description = this.datetotext(startDate, ", ") + " to " + this.datetotext(endDate, ", ");
      } else if (startDate) {
        description = "All entries after " + this.datetotext(startDate, ", ");
      } else if (endDate) {
        description = "All entries before " + this.datetotext(endDate, ", ");
      } else {
        description = "All entries";
      }
      let fronttext = "";
      if (theproject) {
        fronttext += theproject;
      }
      if (tag) {
        if (fronttext != "") {
          fronttext += " ";
        }
        fronttext += "#" + tag;
      }
      if (client) {
        if (fronttext != "") {
          fronttext += " ";
        }
        fronttext += "@" + client;
      }
      if (billed) {
        if (fronttext != "") {
          fronttext += " ";
        }
        fronttext += "(Billed)";
      } else if (billed == false) {
        if (fronttext != "") {
          fronttext += " ";
        }
        fronttext += "(Unbilled)";
      }
      if (fronttext != "") {
        fronttext += ": ";
      }
      description = fronttext + description;

      // Create a new object
      const output = {
        title: title,
        groupby: groupby,
        start: startDate,
        end: endDate,
        project: theproject,
        billed: billed,
        tag: tag,
        client: client,
        entrygroups: [outputentries],
        duration: duration,
        buttons: [],
        descriptions: ["All"],
      };

      if (title) {
        // Create a title label
        output.label = new Gtk.Label({
          label: title,
        });
        let titlestyle = output.label.get_style_context();
        titlestyle.add_class("title-1");
      }
      if (usedescription) {
        output.desc = new Gtk.Label({
          label: description,
          wrap: true,
          margin_top: 12,
          margin_bottom: 12,
        });
      }

      output.box = new Gtk.Box({
        orientation: 1,
      });
      let boxstyle = output.box.get_style_context();
      boxstyle.add_class("linked");

      output.buttons.push(new Gtk.Button({
        label: "Total: " + duration,
      }));

      if (groupby == 1) {
        // Go through each project
        for (let i = 0; i < projects.length; i++) {
          let entrygroup = this.filterentries(startDate, endDate, projects[i], billed, tag, client);
          if (entrygroup[0].duration > 0) {
            output.entrygroups.push(entrygroup);
            output.buttons.push(new Gtk.Button({
              label: projects[i] + ": " + this.secondstoOutput(entrygroup[0].duration),
            }));
            output.descriptions.push("Project: " + projects[i]);
          }
        }
      } else if (groupby == 2) {
        // Go through billed or not
        let billedentries = this.filterentries(startDate, endDate, theproject, true);
        let unbilledentries = this.filterentries(startDate, endDate, theproject, false);
        if (unbilledentries[0].duration > 0) {
          output.entrygroups.push(unbilledentries);
          output.buttons.push(new Gtk.Button({
            label: "Unbilled: " + this.secondstoOutput(unbilledentries[0].duration),
          }));
          output.descriptions.push("Billed: No");
        }
        if (billedentries[0].duration > 0) {
          output.entrygroups.push(billedentries);
          output.buttons.push(new Gtk.Button({
            label: "Billed: " + this.secondstoOutput(billedentries[0].duration),
          }));
          output.descriptions.push("Billed: Yes");
        }
      }

      // Add output to filters[]
      let filterslength = filters.length;
      filters.push(output);

      // Add title and button to the right control
      if (title) {
        widget.append(filters[filterslength].label);
      }
      if (usedescription) {
        widget.append(filters[filterslength].desc);
      }
      widget.append(filters[filterslength].box);
      for (let i = 0; i < filters[filterslength].buttons.length; i ++) {
        filters[filterslength].box.append(filters[filterslength].buttons[i]);
        let thefilter = filters[filterslength];
        filters[filterslength].buttons[i].connect("clicked", () => {
          this.bulkeditdialog(thefilter, i);
        });
      }

      return filterslength;
    } catch (e) {
      console.log(e);
    }
  }

  // If you don't want to use a certain filter, set the property to null
  filterentries(startDate = null, endDate = null, theproject = null, billed = null, tag = null, client = null) {
    try {
      let outputentries = [];
      let total = 0;

      // Go through each entry in entries[]
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        let start = entry.start;
        let end = entry.end;
        if (startDate && !isNaN(startDate)) {
          // pass an entry that ended after startDate
          if (isNaN(entry.end) || entry.end < startDate) {
            continue;
          }
          if (start < startDate) {
            start = startDate;
          }
        }
        if (endDate && !isNaN(endDate)) {
          // pass an entry that started before endDate
          if (entry.start > endDate) {
            continue;
          }
          if (end && end > endDate) {
            end = endDate;
          }
        }
        if (theproject && entry.project != theproject) {
          continue;
        }
        if (billed != null) {
          // pass an entry with the same billed value
          if (entry.billed != billed) {
            continue;
          }
        }
        let tagsearch = " " + entry.project.replace(/[\r\n]+/g, ' ') + " ";
        if (entry.meta) {
          tagsearch += entry.meta.replace(/[\r\n]+/g, ' ') + " ";
        }
        if (tag) {
          tag = tag.split(" ")[0];
          // Find #tag in project and meta
          const tagexp = ` #${tag} `;
          if (!tagsearch.toLowerCase().includes(tagexp.toLowerCase())) {
            continue;
          }
        }
        if (client) {
          client = client.split(" ")[0];
          // Find @client in project and meta
          const clientexp = ` @${client} `;
          if (!tagsearch.toLowerCase().includes(clientexp.toLowerCase())) {
            continue;
          }
        }

        let duration = 0;
        if (end) {
          duration = Math.floor((end - start) / 1000);
        }
        total += duration;
        // Push a passed entry's ID and duration between start and end to outputentries[]
        outputentries.push({ ID: entry.ID, duration: duration, });
      }

      // Add totals line
      outputentries.unshift({ duration: total });

      return outputentries;
    } catch (e) {
      console.log(e);
    }
  }

  // Find the total time between two dates, and output it by project
  // To get all the time entries, make the two dates null
  createtotals(startDate, endDate) {
    try {
      let allt = true;
      if (startDate && endDate) {
        allt = false;
      }

      let totals = [{project: "Total", total: 0}];

      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];

        let start = entry.start;
        let end = entry.end;

        if (end && !isNaN(end) && !isNaN(start) && (allt || (start < endDate && end > startDate))) {
          if (!allt) {
            if (start < startDate) {
              start = startDate;
            }
            if (end > endDate) {
              end = endDate;
            }
          }
          let sum = this.calcTimeDifference(start, end, false);
          if (sum > 0) {
            totals[0].total += sum;

            // Check if project already exists in totals
            let found = false;

            for (let j = 0; j < totals.length; j++) {
              const total = totals[j];
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
    } catch (e) {
      console.log(e);
    }
  }

  async bulkeditentries(entrygroup, newproject, newbilled, startDate = null, endDate = null) {
    try {

      // Clear undo and redo record, since it's not sophisticated enough yet to deal with bulk editing
      sync_changes = [];

      // console.log(newproject + " " + newbilled);
      // console.log(entrygroup);
      if (newproject || newbilled != null) {
        for (let i = 1; i < entrygroup.length; i++) {
          // Get the current info from that entry, entrygroup[i].ID
          let index = this.findindexbyID(entrygroup[i].ID);
          if (index > -1) {
            let start = entries[index].start;
            let end = entries[index].end;
            let theproject = entries[index].project;
            let billed = entries[index].billed;
            let meta = entries[index].meta;
            if (newproject) {
              theproject = newproject;
            }
            if (newbilled != null) {
              billed = newbilled;
            }

            // Decide whether to split !!!
            const now = new Date();
            if ((startDate && start < startDate) || (endDate && ((!end && now > endDate) || end > endDate))) {
              await this.splitentry(index, startDate, endDate);
              // Update the index if this has changed
              index = this.findindexbyID(entrygroup[i].ID);
              start = entries[index].start;
              end = entries[index].end;
            }

            console.log("Will change entry " + index + " to " +
              start + " " + end + " " + theproject + " " + billed);
            this.editentrybyIndex(index, theproject, start, end, billed, meta);
          }
        }
      }
    } catch (e) {
      console.log(e);
    }
  }

  async splitentry(index, startDate, endDate) {
    // Get the entry's info
    let start = entries[index].start;
    let end = entries[index].end;
    let theproject = entries[index].project;
    let billed = entries[index].billed;
    let meta = entries[index].meta;
    /*
    console.log("Filter start: " + startDate);
    console.log("Entry start: " + start);
    console.log("Filter end: " + endDate);
    console.log("Entry end: " + end);
    */
    // Edit the entry to match ((startDate && start < startDate) || (endDate && ((!end && now > endDate) || end > endDate)))
    const now = new Date();
    if (startDate && start < startDate) {
      //console.log("Entry starts before filter. New start date: " + startDate);
      //console.log(entries[index]);
      await this.editentrybyIndex(index, theproject, startDate, end, billed, meta);
      //console.log(entries[index]);
      await this.addentry(theproject, meta, start, new Date(startDate.getTime() - 1), billed, true, 0, index);
      //console.log(entries[index]);
      index += 1;
      start = startDate;
    }
    if (endDate && (end > endDate || (!end && now > endDate))) {
      //console.log("Entry ends after filter");
      await this.editentrybyIndex(index, theproject, start, endDate, billed, meta);
      await this.addentry(theproject, meta, new Date(endDate.getTime() + 1), end, billed, true, 0, index + 1);
    }
  }

  async bulkeditdialog(thefilter, index) {
    try {
      const dialog = new Adw.AlertDialog({
        heading: "Bulk Edit Entries",
        close_response: "cancel",
      });
      dialog.add_response("cancel", "Cancel");
      dialog.add_response("okay", "Edit Entries");
      let startDate = thefilter.start;
      let endDate = thefilter.end;
      let theproject = thefilter.project;
      let billed = thefilter.billed;

      let body = "";
      if (!startDate && !endDate && !theproject && billed == null) {
        body = "Edit ALL entries.";
      } else {
        body = "Edit all entries that meet the following conditions:";
        if (startDate) {
          body += "\nAfter " + this.datetotext(startDate, ", ");
        }
        if (endDate) {
          body += "\nBefore " + this.datetotext(endDate, ", ");
        }
        if (theproject) {
          body += "\nProject: " + theproject;
        }
        if (billed) {
          body += "\nBilled: Yes";
        } else if (billed == false) {
          body += "\nBilled: No";
        }
        if (index > 0) {
          body += "\n" + thefilter.descriptions[index];
        }
      }
      dialog.body = body;

      dialog.set_response_appearance("okay", Adw.ResponseAppearance.DESTRUCTIVE);

      const box = new Gtk.Box({
        orientation: 1,
      });
      const projectlabel = new Gtk.Label({
        label: "Set Project",
      })
      const projectlist2 = new Gtk.DropDown({
        enable_search: true,
      });
      projectlist2.expression = listexpression;
      const model2 = new Gio.ListStore({ item_type: project });
      projectlist2.model = model2;
      model2.append(new project({ value: "<No Change>" }));
      for (let i = 0; i < projects.length; i++) {
        model2.append(new project({ value: projects[i] }));
      }
      box.append(projectlabel);
      box.append(projectlist2);

      const billedlabel = new Gtk.Label({
        label: "Set Billed Status",
      })
      let billednull = new Gtk.CheckButton({
        active: true,
        label: "No change",
      });
      let billedtrue = new Gtk.CheckButton({
        label: "Set as Billed",
        group: billednull,
      });
      let billedfalse = new Gtk.CheckButton({
        label: "Set as Not Billed",
        group: billednull,
      });
      box.append(billedlabel);
      box.append(billednull);
      box.append(billedtrue);
      box.append(billedfalse);

      dialog.set_extra_child(box);

      dialog.connect("response", (_, response_id) => {
        if (response_id == "okay") {
          let newproject = null;
          let newbilled = null;

          const selection = projectlist2.selected_item;
          const value = selection.value;
          if (projectlist2.get_selected() > 0) {
            newproject = value;
          }

          if (billedtrue.get_active()) {
            newbilled = true;
          } else if (billedfalse.get_active()) {
            newbilled = false;
          }

          this.bulkeditentries(thefilter.entrygroups[index], newproject, newbilled, thefilter.start, thefilter.end);
        }
      });

      dialog.present(this);
    } catch (e) {
      console.log(e);
    }
  }

  async groupdialog(groupby = null, tocall = null) {
    try {
      const dialog = new Adw.AlertDialog({
        heading: "Select Grouping",
        close_response: "cancel",
      });
      dialog.add_response("cancel", "Cancel");
      dialog.add_response("okay", "OK");

      const box = new Gtk.Box({
        orientation: 1,
      });

      let groupnull = new Gtk.CheckButton({
        label: "No grouping",
      });
      let groupproject = new Gtk.CheckButton({
        label: "Project",
        group: groupnull,
      });
      let groupbilled = new Gtk.CheckButton({
        label: "Billed",
        group: groupnull,
      });
      box.append(groupnull);
      box.append(groupproject);
      box.append(groupbilled);

      if (groupby == 1) {
        groupproject.set_active(true);
      } else if (groupby == 2) {
        groupbilled.set_active(true);
      } else {
        groupnull.set_active(true);
      }

      dialog.set_extra_child(box);

      dialog.connect("response", (_, response_id) => {
        if (response_id === "okay") {
          if (tocall && typeof tocall === 'function') {
            let newgroupby = 0;
            if (groupproject.get_active()) {
              newgroupby = 1;
            } else if (groupbilled.get_active()) {
              newgroupby = 2;
            }
            tocall(newgroupby);
          }
        }
      });

      dialog.present(this);
    } catch (e) {
      console.log(e);
    }
  }

  async billeddialog(billed = null, tocall = null, commonname = "No change") {
    try {
      const dialog = new Adw.AlertDialog({
        heading: "Select Billed Status",
        close_response: "cancel",
      });
      dialog.add_response("cancel", "Cancel");
      dialog.add_response("okay", "OK");
      if (commonname == "No change") {
        dialog.set_response_appearance("okay", Adw.ResponseAppearance.DESTRUCTIVE);
      }
      const box = new Gtk.Box({
        orientation: 1,
      });

      let billednull = new Gtk.CheckButton({
        label: commonname,
      });
      let billedtrue = new Gtk.CheckButton({
        label: "Billed",
        group: billednull,
      });
      let billedfalse = new Gtk.CheckButton({
        label: "Not Billed",
        group: billednull,
      });
      box.append(billednull);
      box.append(billedtrue);
      box.append(billedfalse);

      if (billed) {
        billedtrue.set_active(true);
      } else if (billed == false) {
        billedfalse.set_active(true);
      } else {
        billednull.set_active(true);
      }

      dialog.set_extra_child(box);

      dialog.connect("response", (_, response_id) => {
        if (response_id === "okay") {
          if (tocall && typeof tocall === 'function') {
            let newbilled = null;
            if (billedtrue.get_active()) {
              newbilled = true;
            } else if (billedfalse.get_active()) {
              newbilled = false;
            }
            tocall(newbilled);
          }
        }
      });

      dialog.present(this);
    } catch (e) {
      console.log(e);
    }
  }

  async projectdialog(theproject = null, tocall = null, commonname = "<No Change>") {
    try {
      const dialog = new Adw.AlertDialog({
        heading: "Select Project",
        close_response: "cancel",
      });
      dialog.add_response("cancel", "Cancel");
      dialog.add_response("okay", "OK");
      if (commonname == "<No Change>") {
        dialog.set_response_appearance("okay", Adw.ResponseAppearance.DESTRUCTIVE);
      }
      const box = new Gtk.Box({
        orientation: 1,
      });
      const projectlist2 = new Gtk.DropDown({
        enable_search: true,
      });
      projectlist2.expression = listexpression;
      const model2 = new Gio.ListStore({ item_type: project });
      projectlist2.model = model2;
      model2.append(new project({ value: commonname }));
      for (let i = 0; i < projects.length; i++) {
        model2.append(new project({ value: projects[i] }));
      }
      box.append(projectlist2);

      dialog.set_extra_child(box);

      if (theproject) {
        let projectindex = projects.indexOf(theproject);
        if (projectindex !== -1) {
          projectlist2.set_selected(projectindex + 1);
        }
      }

      dialog.connect("response", (_, response_id) => {
        if (response_id === "okay") {
          if (tocall && typeof tocall === 'function') {
            let newproject = null;
            const selection = projectlist2.selected_item;
            const value = selection.value;
            if (projectlist2.get_selected() > 0) {
              newproject = value;
            }
            tocall(newproject);
          }
        }
      });

      dialog.present(this);
    } catch (e) {
      console.log(e);
    }
  }

  async datedialog(date = new Date(), tocall = null, body = null, allownodate = false, ampm = ampmformat) {
    if (!date || isNaN(date)) {
      date = new Date();
    }

    const dialog = new Adw.AlertDialog({
      heading: "Choose the Date & Time",
      close_response: "cancel",
    });

    if (body) {
      dialog.body = body;
    }

    dialog.add_response("cancel", "Cancel");
    if (allownodate) {
      dialog.add_response("none", "No Date");
      dialog.set_response_appearance("none", Adw.ResponseAppearance.DESTRUCTIVE);
    }
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
    const datebox = new Gtk.Box({
      orientation: 0,
      valign: 3,
      spacing: 0,
    });
    topbox.append(datebox);

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
    //const secondlabel = new Gtk.Label();
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

    buttonbox.append(yesterdaybutton);
    buttonbox.append(todaybutton);
    datebox.append(monthlist);
    topbox.append(buttonbox);
    datebox.append(dayspin);
    datebox.append(yearspin);
    timebox.append(hourminuteentry);
    timebox.append(secondentry);
    bottombox.append(hourminutelabel);
    bottombox.append(timebox);
    if (ampm) {
      timebox.append(am);
      timebox.append(pm);
      am.label = "AM";
      pm.label = "PM";
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
        let hourminute = hourminuteentry.get_text();
        let hour = 0;
        let minute = 0;
        if (hourminute.length > 2) {
          hour = Math.floor(parseInt(hourminute) / 100);
          minute = parseInt(hourminute) - (hour * 100);
        } else {
          hour = parseInt(hourminute);
        }
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
            chosendate.setHours(hour + 12);
          } else if (am.get_active() && hour == 12) {
            chosendate.setHours(0);
          }
        }
        //console.log("Selected date: " + chosendate);

        if (isNaN(chosendate.getTime())) {
          // If parsing fails, set validated message
          this.datedialog(date,tocall,"The entry was not a valid date or time.");
        } else {
          // If a callback function was given, call that function with the discovered date
          if (tocall && typeof tocall === 'function') {
            tocall(chosendate);
          }
        }
        return chosendate;
      } else if (response_id == "none") {
        if (tocall && typeof tocall === 'function') {
          tocall(null);
        }
        return null;
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

  datetotext(date, separator = "\n", ampm = ampmformat) {
    let dateString = date.toString();
    const year = date.getFullYear().toString();

    const index = dateString.indexOf(year);
    dateString = dateString.slice(0, index + year.length) + separator;

    var hours = date.getHours();
    var minutes = date.getMinutes();
    var seconds = date.getSeconds();
    if (ampm) {
      let format = "AM";
      if (hours > 12) {
        format = "PM";
        hours -= 12;
      } else if (hours == 12) {
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
  async setentries(readentries, merge = false) {
    let change = false;
    let projectsfromlog = [];

    // Is this the first time this log file has been read since it was opened?
    if (sync_firsttime) {
      try {
        // Let later code know that changes are being made
        change = true;

        // Let later code know that the log was already read
        sync_firsttime = false;

        if (!merge) {
          // Stop the timer, if any
          if (logging) {
            this.stopTimer();
          }
        }

        // Preparing for the code that checks if there's a currently running entry, and the code that gets all the projects
        let latestStartDate = null;
        let latestStartIndex = -1;
        let latestStartProject = "";

        // Defining the variable to be written to the visible log
        let new_items = [];
        // Recording how many entries there are currently, so that we can wipe them all out later
        let modelLength = entries.length;

        if (!merge) {
          // Empty entries array
          entries = [];
          // Empty deleted entries array
          sync_extraentries = [];
        }

        // Read through each of the new entries
        for (let i = 0; i < readentries.length; i++) {
          let entry = readentries[i];

          // If the entry has a start date (that means it hasn't been deleted)
          if (!isNaN(entry.start)) {
            let new_item = "";
            // Make sure an empty project is set to "(no project)"
            if (entry.project == "") {
              entry.project = "(no project)";
            }

            // Now add this entry to the entries array
            entries.push(entry);

            // If the entry has no end date
            if (entry.end === null) {
              // Set the text of the item and add it to the new items for the visible log
              new_item = "[???????] | Project: " + entry.project;
              if (entry.meta) {
                new_item += "\n" + entry.meta;
              }

              new_items.unshift(new_item);

              // Check if the start date of this still running entry is later than the current latest start date
              if (latestStartDate === null || entry.start > latestStartDate) {
                // Set this entry to be the currently logging entry (unless a later one appears)
                latestStartDate = entry.start;
                latestStartIndex = i;
                latestStartProject = entry.project;
              }
            } else {
              // If the entry has an end date, go ahead and add it to the new_items
              new_item =
                this.calcTimeDifference(entry.start, entry.end) + " | Project: " + entry.project;
              if (entry.meta) {
                new_item += "\n" + entry.meta;
              }
              new_items.unshift(new_item);
            }

            // This code is the same as some that is described below
            if (addprojectsfromlog) {
              if (projects.indexOf(entry.project) == -1 && projectsfromlog.indexOf(entry.project) == -1) {
                projectsfromlog.push(entry.project);
              }
            }
          } else {
            // This is a deleted entry
            if (entry.end) {
              //console.log("Has date");
              // Remove any old deletions
              // Create date that is two days ago
              let del = new Date();
              del.setDate(del.getDate() - 2);

              if (entry.end > del) {
                sync_extraentries.push({ID: entry.ID, end: entry.end});
              }
            } else {
              //console.log("No date");
              // Assign the dateless deletion a date
              sync_extraentries.push({ID: entry.ID, end: new Date()});
            }
          }
        }
        if (!merge) {
          // Set the visible log contents
          this.logmodel.splice(0, modelLength, new_items);

          // Start logging timer for the latest still running entry
          if (latestStartIndex > -1) {
            this.startTimer(latestStartIndex, latestStartDate);
            // Set that entry as [logging]
            let new_item = "[logging] | Project: " + entries[latestStartIndex].project;

            if (entries[latestStartIndex].meta) {
              new_item += "\n" + entries[latestStartIndex].meta;
            }
            this.logmodel.splice(entries.length - 1 - latestStartIndex, 1, [new_item]);
          }
        } else {
          // Add to the visible log contents
          this.logmodel.splice(0, 0, new_items);

          if (!logging) {
            // Start logging timer for the latest still running entry
            if (latestStartIndex > -1) {
              this.startTimer(latestStartIndex + modelLength, latestStartDate);
              // Set that entry as [logging]
              this.logmodel.splice(entries.length - 1 - latestStartIndex, 1, ["[logging] | Project: " + entries[latestStartIndex].project]);
            }

          } else {
            // Check if the latestStart is later than the currently logging entry
            let current = this.currentTimer();
            if (current) {
              if (entries[current].start < latestStartDate) {
                // Set that entry as [???????]
                this.logmodel.splice(entries.length - 1 - current, 1, ["[???????] | Project: " + entries[current].project]);
                this.stopTimer();

                this.startTimer(latestStartIndex + modelLength, latestStartDate);
                // Set that entry as [logging]
                this.logmodel.splice(entries.length - 1 - current, 1, ["[logging] | Project: " + entries[current].project]);
              }
            }
          }
        }
      } catch (e) {
        console.log(e);
      }
    } else {
      // If we are reading and potentially editing an already opened log
      for (let i = 0; i < readentries.length; i++) {
        const entry = readentries[i];

        // Does the current entry already exist?
        const foundItem = entries.find(item => item.ID === entry.ID);
        if (foundItem) {
          let spot = entries.indexOf(foundItem);

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

          // Check to see if the project, start date, etc. have been changed
          if (entry.project != entries[spot].project || s1 != s2 || e1 != e2 || entry.billed != entries[spot].billed || entry.meta != entries[spot].meta) {
            // Note that there is a change, for a later operation
            change = true;

            // Does the new entry have a start date?
            if (!isNaN(entry.start)) {

              // If so, we will edit it
              console.log("Sync is requesting to edit " + spot);
              this.editentrybyIndex(spot, entry.project, entry.start, entry.end, entry.billed, entry.meta, false);

            } else {

              // If not, we will delete it
              console.log("Sync is requesting to remove " + spot);
              this.removeentrybyIndex(spot, false);
            }

            // If the setting to add projects from a log is set
            if (addprojectsfromlog) {
              // Check if the new item's project exists in projectsfromlog
              if (projects.indexOf(entry.project) == -1 && projectsfromlog.indexOf(entry.project) == -1) {
                // If not, add it, and we'll compare it to the existing projects later
                projectsfromlog.push(entry.project);
              }
            }
          } else {
            //console.log("No need to edit " + spot);
          }
        } else {
          // If the current entry does not exist in the opened log,

          // If there is a start date
          if (!isNaN(entry.start)) {
            // This was an added entry. Add it
            change = true;
            console.log("Sync is requesting to add entry");
            this.addentry(entry.project, entry.meta, entry.start, entry.end, entry.billed, false, entry.ID);

            // This code is identical to what's above
            if (addprojectsfromlog) {
              if (projects.indexOf(entry.project) == -1 && projectsfromlog.indexOf(entry.project) == -1) {
                projectsfromlog.push(entry.project);
              }
            }
          } else {
            //console.log("Skipping a deleted line");
          }
        }
      }

      if (!merge) {
        // Perform QC check to see if anything was deleted entirely.
        // Don't do this if merging files, or we would probably lose data
        // In the current version of this software, it just submissively deletes it rather than objecting
        for (let i = 0; i < entries.length; i++) {
          const foundItem = readentries.find(item => item.ID === entries[i].ID);
          if (!foundItem) {
            console.log("Deletion occurred without warning: " + entries[i]);
            this.removeentrybyIndex(i, false);
          }
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
        if (this.currentTimer() != null) {
          this.setprojectandmeta(entries[this.currentTimer()].project, entries[this.currentTimer()].meta);
        }
      } catch (e) {
        console.log(e);
      }
      this.updatetotals();
    } else {
      //console.log("No change needed");
    }
  }

  // Set the selected project without making a change. This could potentially be used some other places
  async setprojectandmeta(theproject, meta) {
    if (theproject != "(no project)") {
      let projectindex = projects.indexOf(theproject);
      nochange = true;
      if (projectindex !== -1) {
        this._projectlist.set_selected(projectindex);
      }
      if (meta) {
        this._metaentry.set_text(meta);
      } else {
        this._metaentry.set_text("");
      }
      nochange = false;
    }
  }

  async readcsv(text) {
    let readarray = [];

    // Get lines
    let lines = this.splitplus(text, '\n');

    // Get columns
    let columns = this.splitplus(lines[0], ',');

    // Get items from lines and columns
    if (lines.length > 1) {
      for (let i = 1; i < lines.length; i++) {
        if (lines[i] != "") {
          let strings = this.splitplus(lines[i], ',');
          let entry = {};
          for (let j = 0; j < columns.length; j++) {
            let cell = "";
            try {
              // If there's a strings[j], assign it to cell
              cell = strings[j];

              let first = cell.indexOf('"');
              if (first > -1) {
                if (first == 0) {
                  cell = cell.slice(1, cell.length);
                  //console.log("Took first character off: " + cell);
                } else {
                  cell = cell.slice(0, first) + cell.slice(first + 1, cell.length);
                  //console.log("Took character " + first + " off: " + cell);
                }
                let last = cell.lastIndexOf('"');
                if (last == cell.length - 1) {
                  cell = cell.slice(0, cell.length - 1);
                  //console.log("Took last character off: " + cell);
                } else if (last > -1) {
                  cell = cell.slice(0, last) + cell.slice(last + 1, cell.length);
                  //console.log("Took character " + last + " off: " + cell);
                }
                cell = cell.replace(/""/g, '"');
              }
            } catch (_) {}
            entry[columns[j]] = cell;
          }
          readarray.push(entry);
        }
      }
    }
    return readarray;
  }

  splitplus(text, separator, cleanquotes = false) {
    let result = [""];
    let clean = 0;
    if (cleanquotes) {
      clean = 1;
    }

    //console.log("New read");
    try {
      let starti = 0;
      let endi = 0;
      let stop = false;
      for (let i = 0; i < text.length; i++) {
        endi = text.indexOf('"', starti);
        if (endi == -1) {
          endi = text.length + 1;
          stop = true;
        }
        //console.log("End: " + endi);
        if (endi > starti) {
          let chunk = text.slice(starti, endi);
          //console.log(chunk);
          let newlines = chunk.split(separator);
          //console.log(result);
          //console.log(newlines);
          result[result.length - 1] += newlines[0];
          if (newlines.length > 1) {
            for (let j = 1; j < newlines.length; j++) {
              result.push(newlines[j]);
            }
          }
        }
        if (!stop) {
          starti = text.indexOf('"', endi + 1) + 1;
          if (starti == 0) {
            console.log("Malformed CSV file: No closing quotation mark.");
            stop = true;
            starti = text.length + clean;
          }
          //console.log("Start: " + starti);
          if (starti > endi) {
            //console.log(text.slice(endi + clean, starti - clean));
            result[result.length - 1] += text.slice(endi + clean, starti - clean);
          } else if (starti == endi + 1 && clean == 1) {
            result[result.length - 1] += '"';
          }
        } else {
          break;
        }
      }
    } catch (e) {
      console.log(e);
    }

    return result;
  }

  async parsecsv(readarray, merge = false) {
    if (readarray.length > 0) {
      // First, validate columns. Look for project, start, end, ID
      const columns = Object.keys(readarray[0]);
      let projectColumn = "";
      let startColumn = "";
      let endColumn = "";
      let idColumn = "";
      let billedColumn = "";
      let metaColumn = "";

      for (let i = 0; i < columns.length; i++) {
        let column = columns[i];
        if (projectColumn == "" && /project/i.test(column)) {
          projectColumn = column;
        } else if (startColumn == "" && /start/i.test(column)) {
          startColumn = column;
        } else if (endColumn == "" && /end/i.test(column)) {
          endColumn = column;
        } else if (idColumn == "" && /id/i.test(column)) {
          idColumn = column;
        } else if (billedColumn == "" && /billed/i.test(column)) {
          billedColumn = column;
        } else if (metaColumn == "" && /description/i.test(column)) {
          metaColumn = column;
        } else if (!/duration/i.test(column)) {
          // If this is not a duration column, make sure it's in the extra columns list
          const foundItem = sync_extracolumns.indexOf(column);
          if (foundItem == -1) {
            sync_extracolumns.push(column);
          }
        }
      }

      // Then, read from the appropriate columns
      let readentries = [];

      for (let i = 0; i < readarray.length; i++) {
        let entry = readarray[i];

        let endvalue = null;
        try {
          endvalue = new Date(entry[endColumn]);
          if (isNaN(endvalue)) {
            endvalue = null;
          }
        } catch (_) {}

        let projvalue = "";
        try {
          projvalue = entry[projectColumn];
        } catch (_) {}

        let startvalue = null;
        try {
          startvalue = new Date(entry[startColumn]);
        } catch (_) {}

        let billed = false;
        try {
          if (entry[billedColumn] == "true") {
            billed = true;
          }
        } catch (_) {}

        let meta = null;
        try {
          if (entry[metaColumn] != "") {
            meta = entry[metaColumn];
          }
        } catch (_) {}

        let ID = parseInt(entry[idColumn]);
        try {
          // Is the ID a proper number, or is there a duplicate? If not, then assign it an ID
          let now = new Date(); // In case a new ID needs to be made
          if (isNaN(ID)) {
            if (isNaN(entry[startColumn])) {
              console.log("No start date or ID in line " + i + ": removing.");
              changestobemade = true; // Set the app to write the changes that it made
              // Just delete it
              continue;
            } else {
              ID = now.getTime();
              console.log("Invalid ID found: " + entry[idColumn] + ", at line " + i + ", project: " + entry[projectColumn] + ", start: " + entry[startColumn] + " Assigning it new ID: " + ID);
              changestobemade = true; // Set the app to write the changes that it made
            }
          } else if (readentries.find(item => item.ID === ID) || (merge && sync_firsttime && entries.find(item => item.ID === ID))) {
            if (isNaN(entry[startColumn])) {
              console.log("No start date and duplicate ID in line " + i + ": removing.");
              changestobemade = true; // Set the app to write the changes that it made
              // Just delete it
              continue;
            } else {
              ID = now.getTime();
              console.log("Duplicate ID found: " + entry[idColumn] + ", at line " + i + ", project: " + entry[projectColumn] + ", start: " + entry[startColumn] + " Assigning it new ID: " + ID);
              changestobemade = true; // Set the app to write the changes that it made
            }
          }
          // Is there a duplicate ID still? If so, then change this ID
          for (let j = 0; j < readentries.length + entries.length; j++) {
            let duplicate = readentries.find(item => item.ID === ID);
            if (!duplicate && merge && sync_firsttime) {
              duplicate = entries.find(item => item.ID === ID);
              if (!duplicate) {
                duplicate = sync_extraentries.find(item => item.ID === ID);
              }
            }
            if (duplicate) {
              console.log("ID still has duplicate: " + ID + ". Assigning it new ID: " + (ID + 15));
              ID += 15;
            } else {
              break;
            }
          }
        } catch (e) {
          console.log(e);
        }

        let outputentry = {
          start: startvalue,
          end: endvalue,
          project: projvalue,
          ID: ID,
          billed: billed,
          meta: meta,
        };
        // Add unreadable columns
        if (sync_extracolumns.length > 0) {
          for (let j = 0; j < sync_extracolumns.length; j++) {
            outputentry[sync_extracolumns[j]] = entry[sync_extracolumns[j]];
          }
        }

        readentries.push(outputentry);

      }
      this.setentries(readentries, merge);
    }
  }

  // Read text from a file and serve it to function that converts it into the application's entry format
  async readfromfile(thepath = logpath, merge = false) {
    clearInterval(sync_timer);

    const file = Gio.File.new_for_path(thepath);

    // If the file exists
    if (file.query_exists(null)) {
      if (thepath != logpath || !sync_templog) {

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
          //console.log("validate failed: " + error);
        }

        // Convert a UTF-8 bytes array into a String
        const contentsText = new TextDecoder('utf-8').decode(contentsBytes);
        //console.log(contentsText);
        let csv = await this.readcsv(contentsText);
        this.parsecsv(csv, merge);

      } else if (thepath == logpath && sync_templog) {
        // Now that the log is found again
        this.prodigal();
      }
    } else {
      // The file does not exist
      this.lostlog();
    }
  }

  async lostlog(text = "") {
    try {
      if (!sync_templog) {
        console.log("Cannot find file " + logpath);
        sync_templog = true;
        this.stopsynctimer();
        if (sync_autotemplog) {
          await this.settempfile(text, true);
        } else {
          await this.filenotfounddialog(logpath, text, true);
        }
      }
      if (text != "") {
        //console.log("Will write to temp file: " + sync_templogpath + "\n" + text);
        this.writetofile(sync_templogpath, text);
      }
    } catch (e) {
      console.log(e);
    }
  }

  async prodigal() {
    // Create a backup of the temporary log !!!
    // "backup_2024-01-23-145243523.csv"
    console.log("Log has been found again!");
    sync_templog = false;
    if (this.filenotfounddialog) {
      this.filenotfounddialog.close();
    }

    let today = new Date();
    let todaysname = "backup_" + today.getFullYear() +
    "-" + this.intto2digitstring(today.getMonth()+1) + "-" +
    this.intto2digitstring(today.getDate()) + "-" + today.getTime() + ".csv";
    //console.log(todaysname);

    const filepath = GLib.build_filenamev([GLib.get_home_dir(), '.local/share/time-tracker/' + todaysname]);
    await this.createfile(filepath);
    await this.writelog(filepath);

    // Merge the temporary log into the original log
    await this.mergelogs(logpath, sync_templogpath);

    // Delete the temporary log
    console.log("Deleting temporary log: " + sync_templogpath);
    const file = Gio.File.new_for_path(sync_templogpath);
    await file.delete_async(GLib.PRIORITY_DEFAULT, null);
  }

  async filenotfounddialog(thepath, text = "", filehasbeenopened = false) {
    this.filenotfounddialog = new Adw.AlertDialog({
      heading: "Can't Find Log File",
      close_response: "cancel",
    });

    this.filenotfounddialog.body = "Time Tracker couldn't find the previously-used log " +
      "file: " + thepath + ". Maybe it is on a currently inaccessible drive. " +
      "Should time tracker log time in a temporary file and merge the " +
      "changes with your chosen file when it is back online?";


    this.filenotfounddialog.add_response("option1", "Use Temporary File");
    this.filenotfounddialog.add_response("option2", "Use a New or Different File");
    this.filenotfounddialog.add_response("cancel", "Close App");
    this.filenotfounddialog.set_response_appearance("cancel", Adw.ResponseAppearance.DESTRUCTIVE);

    this.filenotfounddialog.connect("response", async (_, response_id) => {
      if (response_id === "cancel") {
        this.close();
      } else if (response_id === "option2") {
        this.firstusedialog();
      } else {
        this.settempfile(text, filehasbeenopened);
      }
      clearInterval(this.filecheck);
    });

    this.filenotfounddialog.present(this);
    this.filecheck = setInterval(() => {
      const file = Gio.File.new_for_path(logpath);
      // If the file exists
      const fileexists = file.query_exists(null);
      if (fileexists) {
        clearInterval(this.filecheck);
        sync_templog = false;
        this.filenotfounddialog.unparent();
        this.filenotfounddialog.run_dispose();
        this.setsynctimer();
      }
    }, 1000);
  }

  // Create temporary file or find existing one, record path in sync_templogpath
  async settempfile(text = "", filehasbeenopened = false) {
    try {
      // Find or create the temp file
      const filepath = GLib.build_filenamev([GLib.get_home_dir(), '.local/share/time-tracker']);
      const directory = Gio.File.new_for_path(filepath);
      sync_templogpath = filepath + "/temporary_log.csv";
      const file = Gio.File.new_for_path(sync_templogpath);
      // If the file exists
      const fileexists = file.query_exists(null);
      if (!fileexists) {
        let success = false;
        if (!directory.query_exists(null)) {
          success = await directory.make_directory_async(GLib.PRIORITY_DEFAULT, null);
        }
        console.log("Tried to write directory " + filepath + ". Success? " + success);
        await this.createfile(sync_templogpath);
      }

      // Save current entries to temporary file, if any
      if (text != "") {
        await this.writelog(sync_templogpath, text);
      } else if (fileexists && !filehasbeenopened) {
        // If existing temp file, read from temp
        await this.readfromfile(sync_templogpath);
      }
      console.log("Using a temporary file: " + sync_templogpath);
      this.setsynctimer();
    } catch (e) {
      console.log(e);
    }
  }

  firstusedialog() {
    const dialog = new Adw.AlertDialog({
      heading: "Choose a Log File",
      close_response: "cancel",
    });

    dialog.body = "Before you start using Time Tracker, choose where " +
      "to store your time logs. You can also edit other settings, like " +
      "the first day of the week, in Time Tracker preferences.";

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

    logpath = filepath + "/log.csv";
    this._settings.set_string("log", logpath);
    const file = Gio.File.new_for_path(logpath);
    // If the file exists
    const fileexists = file.query_exists(null);
    if (!fileexists) {
      let success = false;
      if (!directory.query_exists(null)) {
        success = await directory.make_directory_async(GLib.PRIORITY_DEFAULT, null);
      }
      console.log("Tried to write directory " + filepath + ". Success? " + success);
      await this.createfile(logpath);
      await this.writelog();
    } else {
      await this.readfromfile();
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
          await this.createfile(filepath + "/" + todaysname);
          await this.writelog(filepath + "/" + todaysname, false);
          console.log("Saved a backup for today");
          files.push(todaysname);
        } else {
          console.log("No backup needed");
        }

        // Clean up extra backups according to numberofbackups
        // Keeps the [numberofbackups] newest backups, but will not delete any backups created less than [numberofbackups+1] days ago
        if (deleteold) {
          files.sort();
          let filestodelete = [];
            let numberofbackups = 7;
          try {
            numberofbackups = this._settings.get_int("numberofbackups");
          } catch (_) {
          }
          let todelete = new Date();
          todelete.setDate(today.getDate() - numberofbackups - 1);
          //console.log(todelete);
          let number = 0;
          for (let i = files.length - 1; i > -1; i--) {
            if (files[i].indexOf("backup_" + today.getFullYear()) > -1 || files[i].indexOf("backup_" + today.getFullYear())-1 > -1) {
              number += 1;
              let tosearch = files[i].split("_")[1];
              tosearch = tosearch.split(".")[0];
              let dateoffile = new Date();
              dateoffile.setFullYear(parseInt(tosearch.split("-")[0]));
              dateoffile.setMonth(parseInt(tosearch.split("-")[1])-1);
              dateoffile.setDate(parseInt(tosearch.split("-")[2]));
              //console.log(tosearch);
              //console.log(dateoffile);
              if (dateoffile < todelete && number > numberofbackups) {
                filestodelete.push(files[i]);
              }
            }
          }

          // Delete filestodelete
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

  async createfile(filepath) {
    const file = Gio.File.new_for_path(filepath);
    try {
      await file.create_async(Gio.FileCreateFlags.NONE, GLib.PRIORITY_DEFAULT, null);
    } catch (e) {
      console.log(e);
    }
  }

  async preferencesdialog() {
    try {
      const dialog = new Adw.AlertDialog({
        heading: "Preferences",
        close_response: "cancel",
      });
      dialog.add_response("cancel", "Done");

      const box = new Gtk.Box({
        orientation: 1,
        spacing: 6,
      });

      const label = new Gtk.Label({
        label: "What day should be the first day\nof the week in reports?",
      });
      box.append(label);

      const weeklist = new Gtk.DropDown({
        enable_search: true,
        margin_bottom: 16,
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

      const group1 = new Adw.PreferencesGroup({
        margin_bottom: 16,
      });
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

      const group2 = new Adw.PreferencesGroup({
        margin_bottom: 16,
      });
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

      const group3 = new Adw.PreferencesGroup({
        margin_bottom: 16,
      });
      group3.set_title("Use Temporary Logs");
      group3.set_description("Should Time Tracker automatically use temporary logs when it can't access the main log, instead of asking every time?");
      const temp_switch = new Adw.SwitchRow();
      group3.add(temp_switch);
      box.append(group3);
      temp_switch.set_active(sync_autotemplog);
      temp_switch.connect("notify::active", () => {
        sync_autotemplog = temp_switch.get_active();
        this._settings.set_boolean("autotemplog", sync_autotemplog);
      });

      let loglabel = new Gtk.Label({
        label: "Set Time Tracker to store logs in the app's\nsystem folder, instead of in a user-specified file?",
      });

      const sysbutton = new Gtk.Button();
      sysbutton.label = "Store Logs in App's System Folder";
      sysbutton.connect("clicked", () => {
        this.usesystemfolder();
        this.savedialog();
        loglabel.label = "Now storing logs in app's system folder.";
      });
      box.append(loglabel);
      box.append(sysbutton);

      dialog.set_extra_child(box);
      dialog.present(this);
    } catch (e) {
      console.log(e);
    }
  }
});
