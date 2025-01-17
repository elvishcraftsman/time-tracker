// Welcome to Time Tracker, a project licensed under the MIT-0 no attribution license.

// Perform the necessary imports
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import Adw from 'gi://Adw';
import GLib from 'gi://GLib';
import Gdk from "gi://Gdk";
import { PreferencesWindow } from './preferences.js';

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
let startedTime = new Date(); // The time that the current logging timer started
let entries = []; // The time entries to be displayed and reported on
let projects = []; // The list of projects
let logpath = ""; // The file path of the time log
let addprojectsfromlog = true; // Whether to add new projects when reading a log with projects not in the settings
let currentTimer = null; // The ID of the entry that is currently logging time
let changestobemade = false; // If true, signifies that there are unwritten changes to be written out
let ampmformat = true; // Use AM/PM rather than 24hr time?
let nochange = false; // True when changing projectlist selection, but no change is to be made to an entry
let sync_interval = 1000; // How often to sync to the file, in milliseconds. 1000 seems to work well
let tick = 0; // How many sync checks (ticks) have happened since a certain event
let nexttick = 0; // Which sync check (tick) should be the time when a certain event occurs

// This array is all the changes that have been made. It's mostly useful for undo/redo.
// change, project, start, stop, ID, oldproject, oldstart, oldstop, undone
let sync_changes = [];

// Entries not to be read into entries array, but to be written to the log file
// This is for deleted entries
let sync_extraentries = [];

let sync_firsttime = true; // Is this the first time we're syncing with this log file?
let sync_templogpath = ""; // If the log can't be found, this is the temporary log path
let sync_autotemplog = false; // Should we automatically sync to a temporary log?
let sync_fullstop = false; // Should the timer be stopped rather than paused?
let filelost = false; // Has the log been lost?

// An array that stores the names of any extra columns in the CSV file that TT doesn't use
// These columns are added to each entry in `entries`, so that they aren't lost when writing out
let sync_extracolumns = [];

// An array of report objects to show what preset reports to display
// The first item is always the Custom report, displayed at the bottom of the page
let reports = [{title: "Custom", start: null, end: null, filters: [ { project: null, billed: null, tag: null, client: null } ], groupby: [], }];

let version = "2.1.0"; // The current version of Time Tracker, so that we know when a version change has happened
let dialogsopen = 0; // How many dialogs are currently open (so that we know when there are none open)
let logdays = []; // Dividing the entries to be displayed into an array of the days they were recorded on
let numberofdays = 7; // How many days of entries to show in each page of the log view
let logpage = 0; // Which page of the log we are viewing. Starts at 0, but user-facing number is +1
let timerwidget; // The ActionRow that is displaying the entry that is currently being logged to

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

// Declaring the week content model
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
  InternalChildren: ['status', 'startbutton', 'starticon', 'projectlist',
  'logbox', 'logcontrols', 'add', 'switcher_title', 'menu', 'toast_overlay',
  'customreport', 'reportcontrols', 'reportdata', 'logouter',
  'metaentry', 'presetreports', 'stack', 'page1', 'page3',
  'newbutton', 'openbutton', 'systembutton', 'logscroll'],
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

    // Get the version history gsetting and call the versioning() function in case something should be done depending on the former version
    this.versioning(this._settings.get_string("version"));

    // Read reports setting from gsettings
    let reportsetting = this._settings.get_string("reports");
    if (reportsetting.indexOf("`") > -1) {
      reports = reports.concat(this.settingstoreports(reportsetting));
    }

    // Applying the custom settings
    this.firstdayofweek = this._settings.get_int("firstdayofweek");
    sync_interval = this._settings.get_int("syncinterval") * 1000;
    addprojectsfromlog = this._settings.get_boolean("addprojectsfromlog");
    ampmformat = this._settings.get_boolean("ampmformat");
    sync_autotemplog = this._settings.get_boolean("autotemplog");
    logpath = this._settings.get_string("log");
    
    // Setting the project list
    const projectsSetting = this._settings.get_string("projects");
    try {
      this.setprojects(projectsSetting.split("`"));
    } catch (_) {
      // There aren't any projects
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

    // Connecting the "Edit Projects" button with the proper function
    const projectsAction = new Gio.SimpleAction({name: 'projects'});
    projectsAction.connect('activate', () => this.editprojectdialog());
    this.add_action(projectsAction);

    // Connecting the "Import Log" button with the proper function
    const importAction = new Gio.SimpleAction({name: 'import'});
    importAction.connect('activate', () => this.importlog());
    this.add_action(importAction);

    // Connecting the "Use System Folder" button with the proper function
    const systemAction = new Gio.SimpleAction({name: 'system'});
    systemAction.connect('activate', () => {
      this.usesystemfolder();
      this.savedialog();
    });
    this.add_action(systemAction);

    // Connecting the "Undo" button with the proper function
    const undoAction = new Gio.SimpleAction({name: 'undo'});
    undoAction.connect('activate', () => this.undo());
    this.add_action(undoAction);

    // Connecting the "Redo" button with the proper function
    const redoAction = new Gio.SimpleAction({name: 'redo'});
    redoAction.connect('activate', () => this.redo());
    this.add_action(redoAction);

    // Connecting the "Edit Preset Reports" button with the proper function
    const reportsAction = new Gio.SimpleAction({name: 'reports'});
    reportsAction.connect('activate', () => this.reportsdialog());
    this.add_action(reportsAction);

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

    // Connecting changes in the description and tag text entry with edits of the entry
    this._metaentry.connect("changed", () => {
      if (!nochange && logging) {
        if (this._metaentry.get_text() != "") {
          this.editrunningentrybyIndex(entries[this.currentTimer()].project, this._metaentry.get_text());
        } else {
          this.editrunningentrybyIndex(entries[this.currentTimer()].project, null);
        }
      }
    });

    // Connecting the add entry button with the proper function
    this._add.connect("clicked", () => {
      this.editentrydialog();
    });

    // Display custom report controls
    const controls = this.reportcontrols(reports[0]);
    this._reportcontrols.append(controls);

    // Connecting the preferences button with the proper function
    const prefsAction = new Gio.SimpleAction({name: 'preferences'});
    prefsAction.connect('activate', async () => {
      try {
        //this.preferencesdialog();
        const prefs = new PreferencesWindow;
        prefs.connect("close-request", () => {
          this.updatereports();
        });
        prefs.present();
      } catch (e) {
        console.log(e);
      }
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
        
        // Call something else that will actually close the window, since this block can't
        setInterval(() => {this.close()}, 10);
      } catch (e) {
        console.log(e);
      }
    });

    // Check if there's a user-selected log file, and load it; otherwise, prompt the user to create one
    if (logpath == "") {
      this.firstusedialog();
    } else {
      const file = Gio.File.new_for_path(logpath);
      
      // Can we find that file?
      if (file.query_exists(null)) {
        this.readfromfile_sync();
      } else {
        // File has been lost
        filelost = true;
        if (sync_autotemplog) {
          this.settempfile();
        } else {
          this.newfilenotfounddialog(logpath);
        }
      }
    }
    
    // The following code should be moved into a function
    
        // Connect the "new log" button
        this._newbutton.connect("clicked", () => {
          this.newlog(true);
        });
        
        // Connect the "open log" button
        this._openbutton.connect("clicked", () => {
          this.openlog(true);
        });
        
        // Connect the "system log" button
        this._systembutton.connect("clicked", () => {
          this.usesystemfolder();
          this.closefirstusedialog();
        });

    // All done constructing the window!
  }

  // Welcome the user to this version (in the console)
  // Do any code that should happen if this is the first time opening Time Tracker in the current version
  versioning(versions) {
    try {
      console.log("Welcome to Time Tracker " + version + ".");
      let versionhistory = versions.split(">");
      let lastversion = versionhistory[versionhistory.length - 1];

      // If this is the first time using this version
      if (lastversion != version) {
        // Set the current version as the latest version
        this._settings.set_string("version", versions + ">" + version);
        
        /*  
            Now, execute any further code that we need to
            This is where backwards-compatibility functions should be called
        */
        
      }
      
      // Write out the different versions that this installation has gone through
      console.log("Version history for this installation of Time Tracker: " + versions + ".");
    } catch (e) {
      console.log(e);
    }
  }

  // Read the reports gsetting into the reports[] array
  settingstoreports(setting) {
    let outputArray = [];
    
    // Separate out the different reports
    let reportsArray = setting.split("`/~/`");
    
    // Read the settings for each report
    for (let i = 0; i < reportsArray.length; i++) {
      try {
        let input = reportsArray[i].split("`");
        let output = {};
        
        // Title
        output.title = input[0];
        
        // Start date
        if (input[1].startsWith('day') || input[1].startsWith('week') || input[1].startsWith('month') || input[1].startsWith('year')) {
          output.start = input[1];
        } else {
          output.start = new Date(input[1]);
        }
        
        // End date
        if (input[2].startsWith('day') || input[2].startsWith('week') || input[2].startsWith('month') || input[2].startsWith('year')) {
          output.end = input[2];
        } else {
          output.end = new Date(input[2]);
        }
        
        // Filters
        if (input[3] != "") {
          output.filters = {project: input[3]};
        } else {
          output.filters = {project: null};
        }
        if (input[4] == "true") {
          output.filters.billed = true;
        } else if (input[4] == "false") {
          output.filters.billed = false;
        } else {
          output.filters.billed = null;
        }
        if (input[5] != "") {
          output.filters.tag = input[5];
        } else {
          output.filters.tag = null;
        }
        if (input[6] != "") {
          output.filters.client = input[6];
        } else {
          output.filters.client = null;
        }
        
        // Groups
        output.groupby = [];
        for (let j = 7; j < input.length; j++) {
          output.groupby.push(input[j]);
        }

        outputArray.push(output);
      } catch (_) {}
    }
    return outputArray;
  }

  // Make the reports[] array able to be written out to a string gsetting
  reportstosettings(reportsArray) {
    let output = "";
    
    for (let i = 0; i < reportsArray.length; i++) {
      try {
        let report = reportsArray[i];
        
        output += report.title;
        output += "`"
        output += report.start.toString();
        output += "`"
        output += report.end.toString();
        output += "`"
        
        // Filters
        if (report.filters.project) {
          output += report.filters.project;
        }
        output += "`"
        if (report.filters.billed) {
          output += report.filters.billed.toString();
        }
        output += "`"
        if (report.filters.tag) {
          output += report.filters.tag;
        }
        output += "`"
        if (report.filters.client) {
          output += report.filters.client;
        }
        
        // Groups
        for (let j = 0; j < report.groupby.length; j++) {
          output+= "`" + report.groupby[j];
        }
        
        // Add separator
        if (i < reportsArray.length - 1) {
          output+= "`/~/`"
        }
      } catch (_) {} // !!! Wonder why I'm not looking for errors. Probably a reason.
    }
    return output;
  }

  // Undo the last user action
  async undo() {
    try {
      // Find last item with undefined or false `undone` property in sync_changes
      // But don't undo things if a dialog box is open! The user probably doesn't intend to.
      if (dialogsopen < 1 && sync_changes.length > 0) {
      
        for (let i = sync_changes.length - 1; i > -1; i--) {
        
          if (!sync_changes[i].undone) {
            console.log("Undoing");
            let change = sync_changes[i];
            // Undo that item
            if (change.change == "delete" || change.change == "edit") {
              // Change was an edit or a deletion, changing back is an edit
              this.editentrybyID(change.ID, change.oldproject, change.oldstart, change.oldend, change.oldbilled, change.oldmeta);
            } else {
              // Change was an addition
              this.removeentrybyID(change.ID);
            }
            // Set that item's `undone` property to true, for the sake of later undo/redo actions
            sync_changes[i].undone = true;

            if (logging) {
              // Set the project and description fields in the timer
              this.setprojectandmeta(entries[this.currentTimer()].project, entries[this.currentTimer()].meta);
            }
            
            // Stop looking for more changes, since we've now fulfilled the user's request
            break;
          }
        }
      }
    } catch (e) {
      console.log(e);
    }
  }

  // !!!! This function needs better code comments - not sure I understand it anymore, though it seems to work
  // Redo the last user action
  async redo() {
    try {
      // Find the item in sync_changes with the property `undone` = true that immediately follows the last item with undefined or false `undone` property
      if (dialogsopen < 1 && sync_changes.length > 0) {
      
        for (let i = sync_changes.length - 1; i > -1; i--) {
        
          // If (this item hasn't been undone & it's not the last item) or (this item has been undone and it is the first item) - I think
          // We're checking to find the earliest item that has been undone - I think
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

  // Read from the file, and then start the sync timer when that is done.
  async readfromfile_sync() {
    await this.readfromfile();
    // Start sync timer
    this.setsynctimer();
  }

  // The function to sync with the log file
  async sync() {
    try {
    // Stop sync timer, so that nothing happens while we're in the middle of the process
    clearInterval(sync_timer);

    // Let the program know another sync operation has happened
    tick += 1;
    // Run backups
    try {
      // If we've reached the proper time
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

        // Redo reports
        this.updatereports();
      }
    } catch (_) {
      // Backups failed
    }

    // I have some ideas for making TT more resilient by performing a check of whether recent changes are still kept by the file, but they don't seem to be needed
    // If there are any changes to write out, write them out
    if (changestobemade) {
      console.log("Sync has detected changes to be made: " + changestobemade);
      changestobemade = false;
      await this.writelog();
    } else {
      // If there aren't changes to be made, read the file
      await this.readfromfile();
    }

    // Start sync timer again
    this.resetsynctimer();
    } catch (e) {
      console.log(e);
    }
  }

  // Present a dialog for creating a new log file
  async newlog(insist = false) {
    console.log("Creating new log file");
    const fileDialog = new Gtk.FileDialog();

    // Add filters so that it selects for CSV files, but can be opened for all files in the dropdown
    fileDialog.set_filters(this.filterlist());
    
    // Set the default file name
    fileDialog.set_initial_name("time-tracker-log");

    // Show the save dialog
    fileDialog.save(this, null, async (self, result) => {
      try {
        const file = self.save_finish(result);

        if (file) {
          // Stop syncing before anything else happens
          this.stopsynctimer()
          
          // Set the new log file path
          logpath = file.get_path();

          // Give it the `.csv` file suffix if no suffix has been given
          const basename = file.get_basename();
          if (basename.split(".").length < 2) {
            logpath += ".csv";
          }

          // Save the log file path to gsettings
          this._settings.set_string("log", logpath);

          // Go to the dialog that checks if we want to keep any entries that we currently have
          this.savedialog();
          
          // If it was necessary for us to come away with a chosen file, let the firstusedialog know that one was chosen, so it can stop insisting on the need for one and close
          if (insist) {
            this.closefirstusedialog();
          }
        }
      } catch(_) {
        // user closed the dialog without selecting any file
      }
    });
  }

  // When creating a new log, this is called (maybe another time too)
  // Check to see if there are any entries, and if so, ask if the user wants to save them to the new file before actually creating the new file
  async savedialog() {
    try {
      // Is this needed? !!!!
      filelost = false;
      
      if (entries.length > 0) {
        // If there are any entries, ask whether they should be saved
        const dialog = new Adw.AlertDialog({
          heading: "Save or New?",
          body: "You currently have time entries in your log. Do you want to save " +
          "those entries to the new log file, or do you want to start over, without any entries?",
          close_response: "save"
        });
        dialog.add_response("new", "Start Over");
        dialog.add_response("save", "Save My Data");
        
        // Connect the dialog response
        dialog.connect("response", async (_, response_id) => {
          dialogsopen -= 1;
          try {
            const file = Gio.File.new_for_path(logpath);
            
            // If we don't want to save the data
            if (response_id === "new") {
              if (!file.query_exists(null)) {
                // If the file doesn't exist, create it
                await this.createfile(logpath);
              } else {
                // If the file exists, overwrite it and empty it
                await this.writetofile(logpath, "Project,Start,End,ID");
              }
              // The next sync will be the first time a sync is happening for this file
              sync_firsttime = true;
              
              // Empty sync_extracolumns
              sync_extracolumns = [];
              
              // Empty the entries (Why couldn't we just empty it here rather than calling this function? Probably some reason)
              await this.setentries([]);
            } else {
              // If we do want to save the data
              if (!file.query_exists(null)) {
                // If the file doesn't exist, create it
                await this.createfile(logpath);
              }
              // Save the data
              await this.writelog();
            }
            
            // Start the sync timer going
            this.setsynctimer();
          } catch (e) {
            console.log(e);
          }
        });
        
        // Present the dialog
        dialog.present(this);
        dialogsopen += 1;
      } else {
        // If there are no entries
        if (!file.query_exists(null)) {
          // If the file doesn't exist, create it
          await this.createfile(logpath);
        }
        // Save the data
        await this.writelog();
        
        // Start the sync timer going
        this.setsynctimer();
      }
    } catch (e) {
      console.log(e);
    }
  }

  // This function starts the sync timer for the first time for a file
  // It should be called whenever a new file is opened. Otherwise, call `resetsynctimer()`
  setsynctimer() {
    // Set this as false so that the function isn't called at next sync
    sync_fullstop = false;
    
    // Stop the timer in case it's going
    if (sync_timer !== null) {
      clearInterval(sync_timer);
    }
    
    // Reset things
    sync_firsttime = false;
    tick = 0;
    
    // The next time to check for daily activities (5 min from now)
    nexttick = 300000 / sync_interval;
    
    // Start the timer
    sync_timer = setInterval(() => this.sync(), sync_interval);
    
    console.log("Syncing has been initiated.");
  }

  // This should be called whenever a read or write is completed
  resetsynctimer() {
    // Only reset timer if we haven't been told to stop syncing
    if (!sync_fullstop) {
      // Stop the timer in case it's going
      if (sync_timer !== null) {
        clearInterval(sync_timer);
      }
      
      // Start the timer
      sync_timer = setInterval(() => this.sync(), sync_interval);
    }
  }

  // This method stops the timer, rather than pauses it
  stopsynctimer() {
    // Let everybody know that the timer is supposed to be completely stopped
    sync_fullstop = true;
    
    // Stop the timer completely
    if (sync_timer !== null) {
      clearInterval(sync_timer);
      sync_timer = null;
    }
    console.log("Syncing has been stopped.");
  }

  async importlog() {
    console.log("Importing existing log file");
    // Create a new file selection dialog
    const fileDialog = new Gtk.FileDialog();

    // Add filters so that it selects for CSV files, but can be opened for all files in the dropdown
    fileDialog.set_filters(this.filterlist());

    // Open the dialog and handle user's selection
    fileDialog.open(this, null, async (self, result) => {
      try {
        const file = self.open_finish(result);

        if (file) {
          // Merge the two logs
          this.mergelogs(logpath, file.get_path());
        }
      } catch(_) {
         // user closed the dialog without selecting any file
      }
    });
  }

  /*  This method merges two logs together and considers the result to be the current 
      log. `log2` will be merged into `log1`, which will become or remain the main log.
      By default, values of entries in log1 whose IDs are also found in log2 will be 
      overwritten by those in log2. But if keeporiginal = true, the values in log1 
      will be kept where log2 differs.
  */
  async mergelogs(log1, log2, keeporiginal = false) {
    try {
      if (log1 != log2) {
        console.log("Merging " + log1 + " and " + log2);

        // Make sure it resets everything when reading the new file
        sync_firsttime = true;
        // Empty sync_extracolumns
        sync_extracolumns = [];

        if (!keeporiginal) {
          // Read log1
          await this.readfromfile(log1);
          // Merge in log2 as merge, using it to overwrite matching IDs in log1
          await this.readfromfile(log2, true);
        } else {
          // Read log2
          await this.readfromfile(log2);
          // Merge in log1 as merge, using it to overwrite matching IDs in log2
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
    } catch (e) {
      console.log(e);
    }
  }
  
  // Create list of filters for Gtk.FileDialog() so that it selects for CSV files, but can be opened for all files in the dropdown
  filterlist() {
    const fileFilter1 = new Gtk.FileFilter();
    fileFilter1.add_suffix("csv");
    fileFilter1.set_name("Comma-Separated Values");
    const fileFilter2 = new Gtk.FileFilter();
    fileFilter2.add_pattern("*");
    fileFilter2.set_name("All Files");
    const filterlist = new Gio.ListStore({ item_type: Gtk.FileFilter });
    filterlist.append(fileFilter1);
    filterlist.append(fileFilter2);
    return filterlist;
  }

  // Present a dialog for opening an existing log file
  // insist is whether the openlog should insist on returning a file
  async openlog(insist = false) {
    console.log("Opening existing log file");
    // Create a new file selection dialog
    const fileDialog = new Gtk.FileDialog();

    // Add filters so that it selects for CSV files, but can be opened for all files in the dropdown
    fileDialog.set_filters(this.filterlist());

    // Open the dialog and handle user's selection
    fileDialog.open(this, null, async (self, result) => {
      try {
        const file = self.open_finish(result);

        if (file) {
          this.stopsynctimer()
          logpath = file.get_path();
          
          // Make sure it resets everything when reading the new file
          sync_firsttime = true;
          sync_extracolumns = [];
          filelost = false;
          
          // Read the file
          await this.readfromfile();
          
          // Start sync timer
          this.setsynctimer();
          
          // Write out new log path to gsettings
          this._settings.set_string("log", logpath);

          // If it was necessary for us to come away with a chosen file, let the firstusedialog know that one was chosen, so it can stop insisting on the need for one and close
          if (insist) {
            this.closefirstusedialog();
          }
        }
      } catch(_) {
        // user closed the dialog without selecting any file
      }
    });
  }

  // Convert the log array into CSV format and call a method to write it to the log file
  // `notify` is whether the console.log should be notified
  async writelog(filepath = logpath, filteredentries = null, notify = true) {
    try {
      // Define the string to be written, and add the header row
      let entriesString = "Project,Start Time,End Time,Description,ID,Duration (Readable),Duration (Seconds),Billed";
      
      // Supplement the header row with any extra columns that TT doesn't use
      if (sync_extracolumns.length > 0) {
        for (let i = 0; i < sync_extracolumns.length; i++) {
          entriesString += "," + this.addquotes(sync_extracolumns[i]);
        }
      }

      // Go through each entry
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
          // Dates and duration
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
          // ID, project, billed
          ID = entries[i].ID;
          project = this.addquotes(entries[i].project);
          if (entries[i].billed == true) {
            billed = true;
          }
          // Description
          if (entries[i].meta) {
            meta = entries[i].meta;
          }
        } catch (e) {
          console.log(e);
        }

        if (filteredentries == null) {
          // If we have NOT been given a set of entries to be the ones to write out
          // Add this entry to `entriesString`
          entriesString += '\n' + project + "," + start + "," + end + "," + meta + "," + ID.toString() + "," + duration + "," + seconds + "," + billed.toString();

          // Add any info from extra columns
          if (sync_extracolumns.length > 0) {
            for (let j = 0; j < sync_extracolumns.length; j++) {
              entriesString += ",";
              if (entries[i][sync_extracolumns[j]]) {
                entriesString += this.addquotes(entries[i][sync_extracolumns[j]]);
              }
            }
          }
        } else {
          // If we HAVE been given a set of entries to be the ones to write out
          // Check to see if this entry should be added to `entriesString`
          const foundItem = filteredentries.find(item => item.ID === ID);
          if (foundItem) {
            // Same code as above, redundant for speed purposes
            entriesString += '\n' + project + "," + start + "," + end + "," + meta + "," + ID.toString() + "," + duration + "," + seconds + "," + billed.toString();

            // Add any info from extra columns
            if (sync_extracolumns.length > 0) {
              for (let j = 0; j < sync_extracolumns.length; j++) {
                entriesString += ",";
                if (entries[i][sync_extracolumns[j]]) {
                  entriesString += this.addquotes(entries[i][sync_extracolumns[j]]);
                }
              }
            }
          }
        }
      }

      // If there are any extra entries not in `entries` (would be the case for deleted entries)
      if (sync_extraentries.length > 0 && filteredentries == null) {
        for (let i = 0; i < sync_extraentries.length; i++) {
          let ID = sync_extraentries[i].ID;
          // TT uses the "end" property as the date of deletion
          let deletedate = sync_extraentries[i].end;
          entriesString += '\n,deleted,' + deletedate.toString() +',,' + ID.toString() + ",,,";
          if (sync_extracolumns.length > 0) {
            for (let j = 0; j < sync_extracolumns.length; j++) {
              entriesString += ",";
            }
          }
        }
      }

      const file = Gio.File.new_for_path(filepath);

      if (file.query_exists(null)) {
        // If the file exists
        if (filepath != logpath || !filelost) {
          // If the filepath argument is not the regular log, or if it is, but the log has not been marked as "lost"
          // Write out to the file that was chosen, whether that's the log file or not
          this.writetofile(filepath, entriesString, notify);
        } else {
          // Used to say `else if (filepath == logpath && filelost)` but I think that's redundant
          // This means that the log "was lost, and is found" (see Luke 15:32)
          await this.prodigal();
        }
      } else {
        // The file does not exist; it's been lost. So we need to call this method that will take care of things
        await this.lostlog(entriesString);
      }
    } catch (e) {
      console.log(e);
    }
  }

  // Adds quotes appropriately for CSV format, but only if they are needed
  addquotes(text) {
    if (typeof text === 'string' && (text.includes('"') || text.includes('\n') || text.includes(','))) {
      text = '"' + text.replace(/"/g, '""') + '"';
    }
    return text;
  }

  // This writes any text out to any file
  // `notify` is whether the console.log should be notified
  async writetofile(filepath, text, notify = true) {
    try {
      const file = Gio.File.new_for_path(filepath);
      console.log("Writing to " + filepath);
      
      // Save the file (asynchronously)
      let contentsBytes = new GLib.Bytes(text)
      await file.replace_contents_bytes_async(contentsBytes, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
        
      if (notify) {
        console.log(`Saved to file ${filepath}`);
      }
    } catch (e) {
      logError(`Unable to save to ${filepath}: ${e.message}`);

      // Only notify of an error if we're writing to the regular log
      if (filepath == logpath) {
        if (notify) {
          this._toast_overlay.add_toast(Adw.Toast.new(`Failed to save to file ${filepath}`));
        }
      }
    }
  }

  // Returns the index of the current timer, which is normally specified by ID
  currentTimer() {
    let response = null;
    const foundItem = entries.find(item => item.ID === currentTimer);
    if (foundItem) {
      response = entries.indexOf(foundItem);
    }
    return response;
  }

  // A wrapper for `removeentrybyIndex()` that translates ID to index
  // This is used when the system, rather than the user, is removing an entry
  // Therefore, it doesn't affect sync_changes the same way
  async removeentrybyID(ID) {
    const foundItem = entries.find(item => item.ID === ID);
    if (foundItem) {
      this.removeentrybyIndex(entries.indexOf(foundItem));
    }
  }

  // A wrapper for `removeentrybyIndex()` that records the change in `sync_changes[]`
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

  // Remove the given entry from the entries array and the log control
  async removeentrybyIndex(number, writeout = true) {
    // Add it to `extraentries` so that it isn't considered as simply dropped
    // Use the `end` property as the deleted date
    let del = new Date();
    sync_extraentries.push({ ID: entries[number].ID, end: del });

    // Stop the timer if deleting it
    if (number == this.currentTimer()) {
      this.stopTimer();
    }

    console.log("Deleted entry # " + number + ", ID is " + entries[number].ID + ". It is `" + 
      writeout + "` that this will be written out to the log");
    
    // Remove from `entries` and update the log view and the reports
    entries.splice(number, 1);
    this.updatelog();
    this.updatereports();

    // Let sync know whether to sync this change to the log
    changestobemade = writeout;
  }

  // Stop the entry currently in the timer, and give it the given end date
  async stoprunningentry(endDate) {
    try {
      let current = this.currentTimer();
      console.log("Stopping current timer, index # " + current + ", ID: " + 
        currentTimer + ". This will be written out to the log");
      if (current != null) { // Set as this rather than if (current), to fix a difference in the way Mint Cinnamon is parsing JS
        this.editentry_user(
          current,
          entries[current].project,
          entries[current].start,
          endDate,
          entries[current].billed,
          entries[current].meta,
        );
        changestobemade = true;
      }
    } catch (e) {
      console.log(e);
    }
  }

  // Update the project of the currently running entry, as a user action
  // Functions as a wrapper for `editentry_user()`
  async editrunningentrybyIndex(theproject, meta) {
    let current = this.currentTimer();
    if (current != null) {
      // In case the project is blank
      if (theproject == "") {
        theproject = entries[current].project;
      }
      
      this.editentry_user(current, theproject, entries[current].start, null, entries[current].billed, meta);
    }
  }

  // The dialog to be used when a user wishes to add or edit an entry manually.
  // Should be rewritten as a page !!!! and add code comments then
  // Use no arguments if adding an entry, if editing, give the index number
  async editentrydialog(ID = null, body = "") {
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
      
      let index = -1;
      if (ID != null) {
        index = this.findindexbyID(ID);
        let entry = entries[index];
        startDate = entry.start;
        endDate = entry.end;
        billed = entry.billed;
        meta = entry.meta;
        dialog.heading = "Edit Entry";
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
        orientation: 1,
      });
      box.append(box0);

      const startlabel = new Gtk.Label();
      startlabel.label = "Start & End Time";
      box0.append(startlabel);

      const box1 = new Gtk.Box({
        orientation: 0,
      });
      let timesstyle = box1.get_style_context();
      timesstyle.add_class("linked");
      box0.append(box1);

      const startb = new Gtk.Button();
      box1.append(startb);

      const endb = new Gtk.Button();
      box1.append(endb);

      if (index > -1) {
        theproject = entries[index].project;
        // Set the selected project correctly
        let projectindex = projects.indexOf(theproject);
        if (projectindex !== -1) {
          projectlist2.set_selected(projectindex);
        }

        startb.label = this.datetotext(startDate);
        if (endDate !== null) {
          endb.label = this.datetotext(endDate);
        } else {
          endb.label = "Still Logging\nNo chosen time."
        }
      } else {
        const now = new Date();
        startb.label = this.datetotext(now);
        endb.label = this.datetotext(now);
      }

      const durationlabel = new Gtk.Label({
        label: "Duration",
      });
      box.append(durationlabel);

      const durationb = new Gtk.Button();
      if (endDate != null) {
        durationb.label = this.calcTimeDifference(startDate, endDate);
      } else {
        durationb.label = "Still Logging";
      }
      box.append(durationb);

      startb.connect("clicked", () => {
        this.datedialog(startDate, (date) => {
          startDate = date;
          startb.label = this.datetotext(date);
          if (endDate != null) {
            durationb.label = this.calcTimeDifference(startDate, endDate);
          } else {
            durationb.label = "Still Logging";
          }
        });
      });
      endb.connect("clicked", () => {
        if (endDate != null) {
          this.datedialog(endDate, (date) => {
            endDate = date;
            endb.label = this.datetotext(date);
            if (endDate != null) {
              durationb.label = this.calcTimeDifference(startDate, endDate);
            } else {
              durationb.label = "Still Logging";
            }
          });
        } else {
          this.datedialog(new Date(), (date) => {
            endDate = date;
            endb.label = this.datetotext(date);
            if (endDate != null) {
              durationb.label = this.calcTimeDifference(startDate, endDate);
            } else {
              durationb.label = "Still Logging";
            }
          });
        }
      });
      durationb.connect("clicked", () => {
        this.durationdialog(startDate, endDate, (date) => {
          endDate = date;
          endb.label = this.datetotext(date);
          if (endDate != null) {
            durationb.label = this.calcTimeDifference(startDate, endDate);
          } else {
            durationb.label = "Still Logging";
          }
        });
      });

      const billedb = new Gtk.CheckButton({
        active: false,
        label: "This entry has been billed.",
      });
      if (billed == true) {
        billedb.set_active(true);
      }
      box.append(billedb);
      
      const deleteb = new Gtk.ToggleButton();
      const deletebcontent = new Adw.ButtonContent({
        label: "Delete",
        icon_name: "user-trash-symbolic",
      });
      deleteb.set_child(deletebcontent);
      deleteb.connect("toggled", () => {
        let style = deleteb.get_style_context();
        if (deleteb.get_active()) {
          style.add_class("destructive-action");
        } else {
          if (style.has_class("destructive-action")) {
            style.remove_class("destructive-action");
          }
        }
      });
      box.append(deleteb);

      dialog.set_extra_child(box);

      dialog.connect("response", (_, response_id) => {
        dialogsopen -= 1;
        if (response_id === "okay") {
          // If we're editing, find the index of the entry to edit again, in case it has changed
          if (index > -1) {
            index = this.findindexbyID(ID);
          }
          if (!deleteb.get_active()) {
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
                if (index == this.currentTimer()) {
                  nochange = true;
                  this._projectlist.set_selected(projectlist2.get_selected());
                  this._metaentry.set_text(metaentry2.get_text());
                  nochange = false;
                }
              }
              if (metaentry2.get_text() != "") {
                meta = metaentry2.get_text();
              } else {
                meta = null;
              }
              if (index == -1) {
                console.log("Adding " + theproject + " " + startDate + " " + endDate + " " + billedb.get_active());
                this.addentry_user(theproject, meta, startDate, endDate, billedb.get_active());
              } else {
                console.log("Editing " + index + " " + theproject + " " + startDate + " " + endDate + " " + billedb.get_active());
                this.editentry_user(index, theproject, startDate, endDate, billedb.get_active(), meta);
              }
              if (this.currentTimer() == index && endDate == null) {
                startedTime = startDate; // Update the currently running entry
              }
            } else {
              this.editentrydialog(
                ID,
                "Your response was invalid. Reason: " + validated,
              );
            }
          } else {
            this.removeentry_user(index);
            this._toast_overlay.add_toast(Adw.Toast.new("The entry was deleted."));
          }
        }
      });

      dialog.present(this);
      dialogsopen += 1;
    } catch (e) {
      console.log(e);
    }
  }

  // Present a dialog where the user can edit the projects that show in the projectlist
  async editprojectdialog() {
    try {
      const dialog = new Adw.AlertDialog({
        heading: "Edit Projects",
        body: "Separate projects with line breaks. You can include #tags and @clients.",
        close_response: "cancel",
      });

      dialog.add_response("cancel", "Cancel");
      dialog.add_response("okay", "OK");
      dialog.set_response_appearance("okay", Adw.ResponseAppearance.SUGGESTED);

      // Create outer frame, the TextView, and its buffer
      const frame = new Gtk.Frame();
      const view = new Gtk.TextView({
        editable: true,
        bottom_margin: 4,
        top_margin: 4,
        left_margin: 4,
        right_margin: 4,
      });
      const { buffer } = view;
      let editableProjects = projects.slice(1);
      buffer.set_text(editableProjects.join("\n"), -1);
      frame.set_child(view);
      dialog.set_extra_child(frame);

      // Connect to the user's response
      dialog.connect("response", (_, response_id) => {
        dialogsopen -= 1;
        if (response_id === "okay") {
          let newprojects = buffer.get_text(
            buffer.get_start_iter(),
            buffer.get_end_iter(),
            false,
          );
          
          // Remove leading and trailing line breaks
          newprojects = newprojects.trim();

          // Remove any backticks, since they are needed to separate projects
          newprojects = newprojects.replace("`", "'");

          editableProjects = newprojects.split("\n");
          let newArray = [];
          let newString = "";

          for (let i = 0; i < editableProjects.length; i++) {
            const proj = editableProjects[i];
            
            // In case two \n were following each other
            if (proj != "") {
              // Add to new project array and to settings string
              newArray.push(proj);
              newString += proj;
              
              // Add separator to settings string if needed
              if (i < editableProjects.length - 1) {
                newString += "`";
              }
            }
          }
          // Write out to projects array and gsettings
          this.setprojects(newArray);
          this._settings.set_string("projects", newString);
        }
      });

      // Present the dialog and let TT know that a new dialog is open
      dialog.present(this);
      dialogsopen += 1;
    } catch (e) {
      console.log(e);
    }
  }
  
  // This method updates the visible log when any changes are made
  // It prepares the `logdays[]` array with all the info, and then calls `loadlog()`
  async updatelog(entryID = null, formerstart = null, formerend = null) {
    try {
      // Sort the entries into a new array, empty logdays[]
      const sortedentries = [...entries].sort((b, a) => new Date(a.start) - new Date(b.start));
      logdays = [];
      
      // Add each entry to its proper day in `logdays[]`
      sortedentries.forEach(entry => {
        if (logdays.length == 0 || logdays[logdays.length - 1].day == null || 
        logdays[logdays.length-1].day.getFullYear() != entry.start.getFullYear() || 
        logdays[logdays.length-1].day.getMonth() != entry.start.getMonth() || 
        logdays[logdays.length-1].day.getDate() != entry.start.getDate()) {
          logdays.push({day: entry.start, IDs: [entry.ID]});
        } else {
          logdays[logdays.length - 1].IDs.push(entry.ID);
        }
      });
      
      this.loadlog();
    } catch (e) {
      console.log(e);
    }
  }
  
  // A wrapper for `loadlog()` in case we're going to the next page
  async loadnextpage() {
    // Delete `logbox` and recreate it, so that the new page is scrolled to the top
    if (this._logbox) {
      this._logbox.unparent();
      this._logbox.run_dispose();
      this._logbox = new Gtk.ScrolledWindow();
      this._logouter.append(this._logbox);
    }
    
    this.loadlog(true);
  }
  
  // After the log info has been updated, or a button clicked, load the change.
  // If `pagenav` is true, that means we're going to a new page, not writing the log after a change
  async loadlog(pagenav = false) {
    try {
      // Make sure we don't go out of bounds in trying to load a page that doesn't exist
      if (logpage > 0 && numberofdays * logpage > logdays.length - 1) {
        logpage = logdays.length -1;
      }
      
      const box = new Gtk.Box({ // Outer box
        orientation: 1,
      });
      
      // Go through all the days that are in the current range for displaying
      for (let i = numberofdays * logpage; i < (numberofdays * logpage) + numberofdays; i++) {
        // Make sure we don't go beyond the number of days!
        if (i < logdays.length) {
          const daybox = new Adw.PreferencesGroup({ // The PreferencesGroup containing a certain day
            margin_bottom: 12,
            margin_start: 6,
            margin_end: 6,
            title: this.datetodaytitle(logdays[i].day),
          });
          
          // If it's the first day in the range
          if (i == numberofdays * logpage) {
            daybox.set_margin_top(18);
          }
          
          // Go through all the different entries organized in this day
          logdays[i].IDs.forEach(ID => {
            // Get the actual entry
            const index = this.findindexbyID(ID);
            const entry = entries[index];
            
            // Find the `title` property of the ActionRow below
            let description = "";
            if (entry.meta != null) {
              if (entry.project == "(no project)") {
                description = entry.meta;
              } else {
                // 55% is equivalent to .dim Adwaita class
                description = entry.project + '  <span font_weight="bold" fgalpha="55%">' + entry.meta + '</span>';
              }
            } else {
              description = entry.project;
            }
            
            // Create the edit button and the ActionRow
            const button = new Gtk.Button({
              halign: 3,
              valign: 3,
              label: _("show toast"),
              icon_name: "document-edit-symbolic",
            });
            const row = new Adw.ActionRow({
              title: description,
            });
            
            // Decide whether to display a duration in the `subtitle` or the current timer
            if (entry.end === null) {
              if (index == this.currentTimer()) {
                // Display timer
                timerwidget = row;
                const currentDate = new Date();
                const text = this.calcTimeDifference(startedTime, currentDate);
                timerwidget.subtitle = "<b>" + text + "</b>";
              } else {
                // By some fluke, we have a row that doesn't have an end date
                row.subtitle = "<b>[??????]</b>";
              }
            } else {
              // Display duration
              row.subtitle = "<b>" + this.calcTimeDifference(entry.start, entry.end) + "</b>";
            }
            
            // Add button, add row the the PreferencesGroup
            row.add_suffix(button);
            button.connect("clicked", () => {
              this.editentrydialog(ID);
            });
            daybox.add(row);
          });
          
          box.append(daybox);
        } else {
          break;
        }
      }
    
      if (!pagenav) {
        // If we're not going to a different page, delete all current log entries
        // (This would be redundant otherwise, since the logbox itself has already been deleted and re-created)
        let child = this._logbox.get_child();
        if (child) {
          child.unparent();
          child.run_dispose();
        }
      }
      
      // Add the new log info
      this._logbox.set_child(box);
      
      // Delete all current buttons in the bottom bar so that we can re-create them correctly
      for (let i = 0; i < 100; i++) {
        let child = this._logcontrols.get_first_child();
        if (child) {
          child.unparent();
          child.run_dispose();
        } else {
          break;
        }
      }
      
      // Find number of pages of days
      let numpages = Math.ceil(logdays.length / numberofdays);
      
      if (numpages > 1) {
        // If there's more than one page, 
        // get the first and last pages
        let displaypages = [0, numpages - 1];
        // If the current page is not one of those, get it too
        if (logpage > 0 && logpage < numpages - 1) {
          displaypages.push(logpage);
        }
        // Add the pages on either side of the current page, up to five pages total
        for (let i = 1; i < 6; i++) {
          if (displaypages.length >= 5) {
            break;
          } else {
            if (logpage - i > 1 && !displaypages.includes(logpage - i)) {
              displaypages.push(logpage - i);
            } if (logpage + i < numpages && !displaypages.includes(logpage + i)) {
              displaypages.push(logpage + i);
            }
          }
        }
        
        // Sort them in order
        displaypages.sort((a, b) => a - b);
        
        for (let i = 0; i < displaypages.length; i++) {
          // Create a button for each page
          const button = new Gtk.Button({
            label: (displaypages[i] + 1).toString(),
          });
          let style2 = button.get_style_context();
          style2.add_class("flat");
          style2.add_class("no-padding");
          
          // Mark the current page as not clickable, and handle the click events of others
          if (displaypages[i] == logpage) {
            button.set_sensitive(false);
          } else {
            button.connect("clicked", () => {
              logpage = displaypages[i];
              this.loadnextpage();
            });
          }
          
          this._logcontrols.append(button);
          
          // If the next page in the list is more than one step up (there's a skip)
          if (displaypages[i + 1] > displaypages[i] + 1) {
            // Create a button that visually shows the break
            const button2 = new Gtk.Button({
              label: ".",
            });
            let style3 = button2.get_style_context();
            style3.add_class("flat");
            style3.add_class("no-padding");
            
            // Have it open a dialog that goes to a selected page, with a reasonable default number
            button2.connect("clicked", () => {
              if (displaypages[i] == 1) {
                this.gotopagedialog(Math.ceil((displaypages[i + 1] - displaypages[i]) / 2 + displaypages[i]));
              } else {
                this.gotopagedialog(Math.floor((displaypages[i + 1] - displaypages[i]) / 2 + displaypages[i]));
              }
            });
            this._logcontrols.append(button2);
          }
        }
      } else {
        // if there's only one page, create an invisible button to hold space in the bottom bar
        const button = new Gtk.Button({
          label: "",
        });
        let style2 = button.get_style_context();
        style2.add_class("flat");
        style2.add_class("no-padding");
        button.set_sensitive(false);
        this._logcontrols.append(button);
      }
    } catch (e) {
      console.log(e);
    }
  }
  
  // Calls a dialog that will take you to your selected page
  // `number` is the default value
  async gotopagedialog(number = 1) {
    try {
      const dialog = new Adw.AlertDialog({
        heading: "Go to Page",
        body: "Pick a page to go to.",
        close_response: "cancel",
      });

      dialog.add_response("cancel", "Cancel");
      dialog.add_response("okay", "OK");
      
      const spin = new Gtk.SpinButton({
        orientation: 0,
        width_request: 60,
      });
      
      // Make sure to set the proper range and value
      spin.set_range(1, Math.ceil(logdays.length / numberofdays));
      spin.set_value(number);

      dialog.set_extra_child(spin);

      dialog.set_response_appearance("okay", Adw.ResponseAppearance.SUGGESTED);

      dialog.connect("response", (_, response_id) => {
        dialogsopen -= 1;
        if (response_id === "okay") {
          logpage = spin.get_value() - 1;
          this.loadnextpage();
        }
      });

      dialog.present(this);
      dialogsopen += 1;
    } catch (e) {
      console.log(e);
    }
  }

  // A wrapper for `editentrybyIndex()` that is only used by the system
  async editentrybyID(ID, project, start, end, billed, meta) {
    const foundItem = entries.find(item => item.ID === ID);
    if (foundItem) {
      // Edit the entry
      this.editentrybyIndex(entries.indexOf(foundItem), project, start, end, billed, meta);
    } else {
      // The entry was probably deleted, so we need to reinstate it
      // Remove the entry from sync_extraentries
      const foundDeletion = sync_extraentries.find(item => item.ID === ID);
      if (foundDeletion) {
        sync_extraentries.splice(sync_extraentries.indexOf(foundDeletion), 1);
      }
      // Recreate the entry
      this.addentry(project, meta, start, end, billed, true, ID);
    }
  }

  // Finds a given index from an ID. Is useful for keeping code short sometimes.
  findindexbyID(ID) {
    const foundItem = entries.find(item => item.ID === ID);
    return entries.indexOf(foundItem);
  }

  // A wrapper for `editentrybyIndex()` that is called by a user action
  async editentry_user(number, theproject, startDate, endDate, billed, meta, writeout = true) {
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
    this.editentrybyIndex(number, theproject, startDate, endDate, billed, meta, writeout);
  }

  // Edit the given entry
  async editentrybyIndex(number, theproject, startDate, endDate, billed, meta, writeout = true) {
    // If the entry didn't have an end date, but does now, stop the timer
    if (entries[number].end == null && endDate != null) {
      this.stopTimer();
    }
    entries[number].project = theproject;
    entries[number].start = startDate;
    entries[number].end = endDate;
    entries[number].billed = billed;
    entries[number].meta = meta;
    
    console.log("Edited entry # " + number + ", ID is " + entries[number].ID + ". It is `" + 
      writeout + "` that this will be written out to the log");
    
    if (endDate != null) {
      this.updatereports();
    }
    this.updatelog();
    
    // Mark that there are changes to sync
    changestobemade = writeout;
  }

  // This is a wrapper for `addentry()` that is called by a user action
  async addentry_user(theproject, meta, startDate, endDate = null, billed = false, writeout = true, ID = 0) {
    try {
      // Create a new ID for the entry
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

      this.addentry(theproject, meta, startDate, endDate, billed, writeout, ID);
    } catch (e) {
      console.log(e);
    }
  }

  // Add the given entry to the entries array and the log control
  async addentry(theproject, meta, startDate, endDate = null, billed = false, writeout = true, ID = 0, index = -1) {
    try {
      // If the entry doesn't have an ID yet, create a new one
      const now = new Date();
      if (ID == 0) {
        ID = now.getTime();
      }

      if (index == -1 || index > entries.length) {
        // If there's no particular index chosen for this entry, or the index is out of range
        entries.push({ start: startDate, end: endDate, project: theproject, ID: ID, billed: billed, meta: meta });

        if (endDate === null && !logging) {
          this.startTimer(entries.length - 1, startDate);
        } else {
          this.updatereports();
        }

        console.log("Added entry # " + (entries.length - 1) + ", ID is " + ID + ". It is `" + 
          writeout + "` that this will be written out to the log");
      } else {
        // If there's a chosen index, put it there
        entries.splice(index, 0, { start: startDate, end: endDate, project: theproject, ID: ID, billed: billed, meta: meta });

        if (endDate === null && !logging) {
          this.startTimer(index, startDate);
        } else {
          this.updatereports();
        }

        console.log("Added entry # " + index + ", ID is " + ID + ". It is `" + 
          writeout + "` that this will be written out to the log");
      }
      this.updatelog();
        
      // Mark that there are changes to write out
      changestobemade = writeout;
    } catch (e) {
      console.log(e);
    }
  }
  
  // !!!! start adding code comments here
  // Replace the current projects with the given projects in the array.
  // If a project was selected already, try to select that same project when the projectlist reloads.
  // Don't use a try {} block, since the code calling it is expecting an error
  async setprojects(projectArray = []) {
    const selection = this._projectlist.get_selected();
    let theproject = "";
    if (selection) {
      theproject = projects[selection];
    }
    // Update the project list
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
    try {
      // Stop logging
      logging = false;
      clearInterval(timer);
      
      // Make sure that the actionrow that had the timer is up to date
      let entry = entries[this.currentTimer()];
      timerwidget.subtitle = "<b>" + this.calcTimeDifference(entry.start, entry.end) + "</b>";
      
      // Reset everything
      currentTimer = null;
      timerwidget = null;
      this._starticon.set_icon_name("media-playback-start-symbolic");
      let style = this._startbutton.get_style_context();
      if (style.has_class("destructive-action")) {
        style.remove_class("destructive-action");
      }
      style.add_class("suggested-action");
      this.setTimerText();

      if (this._settings.get_boolean("resetproject")) {
        this._projectlist.set_selected(0); // Reset project to (no project)
      }
      if (this._settings.get_boolean("resetdescription")) {
        this._metaentry.set_text("");
      }
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
        const text = this.calcTimeDifference(startedTime, currentDate);
        this._status.label = text;
        if (timerwidget != null) {
          timerwidget.subtitle = "<b>" + text + "</b>";
        }
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
  startTimer(number, startDate) {
    logging = true;
    startedTime = startDate;
    timer = setInterval(() => this.setTimerText(), 1000);
    currentTimer = entries[number].ID;
    this.setTimerText();
    this._starticon.set_icon_name("media-playback-stop-symbolic");
    let style = this._startbutton.get_style_context();
    if (style.has_class("suggested-action")) {
      style.remove_class("suggested-action");
    }
    style.add_class("destructive-action");
    console.log("Started entry # " + number + ", ID is " + currentTimer);
  }

  // Convert from seconds to output format
  secondstoOutput(seconds) {
    const hours = Math.floor(seconds / 3600);
    seconds = seconds - (hours * 3600);
    const minutes = Math.floor(seconds / 60);
    seconds = seconds - (minutes * 60);

    return this.intto2digitstring(hours) + ":" + this.intto2digitstring(minutes) + ":" + this.intto2digitstring(seconds);
  }

  // Update the reports
  async updatereports() {
    try {
      /*
        - destroys all existing reporting widgets (all children of this._nav_view)
        - empties filters[] and nav_pages[]
        - reads through the list of reports, creating each one with displayfilter(reports[0]);
        - creates custom report with displaycustomfilter();
      */
      //this.firstdayofweek = this._settings.get_int("firstdayofweek");

      for (let i = 0; i < 100; i++) {
        let child = this._presetreports.get_first_child();
        if (child) {
          child.unparent();
          child.run_dispose();
        } else {
          break;
        }
      }

      for (let i = 1; i < reports.length; i++) {
        if (!reports[i].deleted) { // This if should probably not be needed
          this.displayfilter(reports[i]);
        }
      }

      this.displaycustomfilter();
    } catch (e) {
      console.log(e);
    }
  }

  async displaycustomfilter() {
    try {
      for (let i = 0; i < 100; i++) {
        let child = this._reportdata.get_first_child();
        if (child) {
          child.unparent();
          child.run_dispose();
        } else {
          break;
        }
      }

      const report = reports[0];
      let startDate = new Date();
      if (report.start && isNaN(report.start)) {
        startDate = this.editdate(startDate, report.start, true);
      } else {
        startDate = report.start;
      }

      let endDate = new Date();
      if (report.end && isNaN(report.end)) {
        endDate = this.editdate(endDate, report.end, false);
      } else {
        endDate = report.end;
      }

      const filter = this.filterentries(startDate, endDate, report.filters.project, report.filters.billed, report.filters.tag, report.filters.client);
      this.displayfilterpart(this._reportdata, "Total", filter, report.groupby, startDate, endDate, report.filters.project, report.filters.billed, report.filters.tag, report.filters.client);

    } catch (e) {
      console.log(e);
    }
  }

  reportcontrols(report) {
    const box = new Gtk.Box({
      orientation: 1,
      spacing: 6,
      halign: 3,
    });
    const box1 = new Gtk.Box({
      halign: 3,
    });
    let style = box1.get_style_context();
    style.add_class("linked");
    const box2 = new Gtk.Box({
      halign: 3,
    });
    let style2 = box2.get_style_context();
    style2.add_class("linked");
    box.append(box1);
    box.append(box2);

    const startbutton = new Gtk.Button();
    const endbutton = new Gtk.Button();
    box1.append(startbutton);
    box1.append(endbutton);
    const filterbutton = new Gtk.Button();
    const groupbutton = new Gtk.Button();
    box2.append(filterbutton);
    box2.append(groupbutton);

    if (report.start) {
      if (isNaN(report.start)) {
        startbutton.set_label(this.datetohuman(report.start));
      } else {
        startbutton.set_label(this.datetotext(report.start));
      }
    } else {
      startbutton.set_label("Start Date");
    }
    if (report.end) {
      if (isNaN(report.end)) {
        endbutton.set_label(this.datetohuman(report.end));
      } else {
        endbutton.set_label(this.datetotext(report.end));
      }
    } else {
      endbutton.set_label("End Date");
    }
    let numberoffilters = 0;
    if (report.filters) {
      if (report.filters.project) {
        numberoffilters += 1;
      }
      if (report.filters.billed != null) {
        numberoffilters += 1;
      }
      if (report.filters.tag) {
        numberoffilters += 1;
      }
      if (report.filters.client) {
        numberoffilters += 1;
      }
    }
    filterbutton.set_label("Filters: " + numberoffilters);
    if (report.groupby) {
      groupbutton.set_label("Groups: " + report.groupby.length);
    } else {
      groupbutton.set_label("Groups: 0");
    }

    startbutton.connect("clicked", () => {
      this.reportdatedialog(report.start, (date) => {
        report.start = date;
        this.displaycustomfilter();
        if (report.start) {
          if (isNaN(report.start)) {
            startbutton.set_label(this.datetohuman(report.start));
          } else {
            startbutton.set_label(this.datetotext(report.start));
          }
        } else {
          startbutton.set_label("Start Date");
        }
      }, true);
    });
    endbutton.connect("clicked", () => {
      this.reportdatedialog(report.end, (date) => {
        report.end = date;
        this.displaycustomfilter();
        if (report.end) {
          if (isNaN(report.end)) {
            endbutton.set_label(this.datetohuman(report.end));
          } else {
            endbutton.set_label(this.datetotext(report.end));
          }
        } else {
          endbutton.set_label("End Date");
        }
      }, false);
    });
    filterbutton.connect("clicked", () => {
      this.reportfiltersdialog(report, () => {
        let numberoffilters = 0;
        try {
          if (report.filters.project) {
            numberoffilters += 1;
          }
          if (report.filters.billed != null) {
            numberoffilters += 1;
          }
          if (report.filters.tag) {
            numberoffilters += 1;
          }
          if (report.filters.client) {
            numberoffilters += 1;
          }
        } catch (_) {}
        filterbutton.set_label("Filters: " + numberoffilters);
        this.displaycustomfilter();
      });
    });
    groupbutton.connect("clicked", () => {
      this.groupdialog(report, () => {
        if (report.groupby) {
          groupbutton.set_label("Groups: " + report.groupby.length);
        } else {
          groupbutton.set_label("Groups: 0");
        }
        this.displaycustomfilter();
      });
    });
    return box;
  }

  datetohuman(string) {
    let output = string;
    if (string == "day+0" || string == "day-0") {
      output = "Today";
    } else if (string == "week+0" || string == "week-0") {
      output = "This Week";
    } else if (string == "month+0" || string == "month-0") {
      output = "This Month";
    } else if (string == "year+0" || string == "year-0") {
      output = "This Year";
    } else if (string == "day-1") {
      output = "Yesterday";
    } else if (string == "week-1") {
      output = "Last Week";
    } else if (string == "month-1") {
      output = "Last Month";
    } else if (string == "year-1") {
      output = "Last Year";
    } else if (string == "day+1") {
      output = "Tomorrow";
    } else if (string == "week+1") {
      output = "Next Week";
    } else if (string == "month+1") {
      output = "Next Month";
    } else if (string == "year+1") {
      output = "Next Year";
    } else {
      if (string.indexOf("+") > -1) {
        let a = string.split("+");
        let now = "";
        if (a[0] == "day") {
          now = "today";
        } else {
          now = "this " + a[0];
        }
        output = a[1] + " " + a[0] + "s after\n" + now;
      } else if (string.indexOf("-") > -1) {
        let a = string.split("-");
        let now = "";
        if (a[0] == "day") {
          now = "today";
        } else {
          now = "this " + a[0];
        }
        output = a[1] + " " + a[0] + "s before\n" + now;
      }
    }
    return output;
  }

  // edit is in the form of day+0, week-10, etc.
  // start = true means that it's at the start of the time period
  editdate(date, edit, start) {
    let current = new Date(date);
    if (start) {
      current.setHours(0, 0, 0, 0);
    } else {
      current.setHours(23, 59, 59, 999);
    }
    if (edit.indexOf("+") > -1) {
      let a = edit.split("+");
      if (a[0] == "day") {
        current.setDate(current.getDate() + parseInt(a[1]));
      } else if (a[0] == "week") {
        for (let i = 0; i >= -6; i--) {
          let currentDate = new Date(current);
          currentDate.setDate(current.getDate() + i);
          if (currentDate.getDay() === this.firstdayofweek) {
            current = currentDate;
            break;
          }
        }
        if (!start) {
          current.setDate(current.getDate() + 6);
        }
        current.setDate(current.getDate() + (parseInt(a[1]) * 7));
      } else if (a[0] == "month") {
        current.setMonth(current.getMonth() + parseInt(a[1]));
        if (start) {
          current.setDate(1);
        } else {
          let newdate = new Date(current);
          newdate.setDate(1);
          newdate.setMonth(newdate.getMonth() + 1);
          newdate.setDate(newdate.getDate() - 1);
          current.setDate(newdate.getDate());
        }
      } else if (a[0] == "year") {
        current.setFullYear(current.getFullYear() + parseInt(a[1]));
        if (start) {
          current.setMonth(0);
          current.setDate(1);
        } else {
          current.setMonth(11);
          current.setDate(31);
        }
      }
    } else if (edit.indexOf("-") > -1) {
      let a = edit.split("-");
      if (a[0] == "day") {
        current.setDate(current.getDate() - parseInt(a[1]));
      } else if (a[0] == "week") {
        for (let i = 0; i >= -6; i--) {
          let currentDate = new Date(current);
          currentDate.setDate(current.getDate() + i);
          if (currentDate.getDay() === this.firstdayofweek) {
            current = currentDate;
            break;
          }
        }
        if (!start) {
          current.setDate(current.getDate() + 6);
        }
        current.setDate(current.getDate() - (parseInt(a[1]) * 7));
      } else if (a[0] == "month") {
        current.setMonth(current.getMonth() - parseInt(a[1]));
        if (start) {
          current.setDate(1);
        } else {
          let newdate = new Date(current);
          newdate.setDate(1);
          newdate.setMonth(newdate.getMonth() + 1);
          newdate.setDate(newdate.getDate() - 1);
          current.setDate(newdate.getDate());
        }
      } else if (a[0] == "year") {
        current.setFullYear(current.getFullYear() - parseInt(a[1]));
        if (start) {
          current.setMonth(0);
          current.setDate(1);
        } else {
          current.setMonth(11);
          current.setDate(31);
        }
      }
    }
    return current;
  }

  filterbuttons(parent, title, filter, start, end, theproject, billed, tag, client) {
    const box = new Gtk.Box({
      hexpand: true,
      margin_top: 3,
      margin_bottom: 3,
    });
    const label = new Gtk.Label();
    label.set_markup("<b>" + title + ":</b>");
    const button = new Gtk.Button({
      label: this.secondstoOutput(filter[0].duration),
      hexpand: true,
      halign: 2,
    });
    if (filter.length > 1) {
      button.connect("clicked", () => {
        this.filterdetailsdialog(filter, start, end, theproject, billed, tag, client);
      });
    }
    box.append(label);
    box.append(button);
    parent.append(box);
  }

  // This function displays a preset group of filters in the Preset area
  async displayfilter(report) {
    try {
      const reportbox = new Gtk.Box({
        margin_bottom: 24,
      });
      let style1 = reportbox.get_style_context();
      style1.add_class("card");
      const box = new Gtk.Box({
        orientation: 1,
        hexpand: true,
        margin_start: 24,
        margin_end: 24,
        margin_top: 24,
        margin_bottom: 24,
      });
      reportbox.append(box);
      const label = new Gtk.Label({
        label: report.title,
        margin_bottom: 12,
      });
      let style = label.get_style_context();
      style.add_class("title-1");
      box.append(label);
      const box1 = new Gtk.Box({
        orientation: 1,
        hexpand: true,
      });
      box.append(box1);

      let startDate = new Date();
      if (report.start && isNaN(report.start)) {
        startDate = this.editdate(startDate, report.start, true);
      } else {
        startDate = report.start;
      }

      let endDate = new Date();
      if (report.end && isNaN(report.end)) {
        endDate = this.editdate(endDate, report.end, false);
      } else {
        endDate = report.end;
      }

      const filter = this.filterentries(startDate, endDate, report.filters.project, report.filters.billed, report.filters.tag, report.filters.client);
      this.displayfilterpart(box1, "Total", filter, report.groupby, startDate, endDate, report.filters.project, report.filters.billed, report.filters.tag, report.filters.client);

      this._presetreports.append(reportbox);

    } catch (e) {
      console.log(e);
    }
  }

  async exporttocsv(filteredentries) {
    try {

      const fileDialog = new Gtk.FileDialog();

      // Add filters so that it selects for CSV files, but can be opened for all files in the dropdown
      fileDialog.set_filters(this.filterlist());

      fileDialog.save(this, null, async (self, result) => {
        try {
          const file = self.save_finish(result);
          console.log(file);

          if (file) {
            let path = file.get_path();

            // Default to CSV suffix if none chosen
            const basename = file.get_basename();
            if (basename.split(".").length < 2) {
              path += ".csv";
            }
            if (!file.query_exists(null)) {
              await this.createfile(path);
            }
            console.log("Exporting entries to " + path);
            this.writelog(path, filteredentries);
          }
        } catch(_) {
          console.log("No file chosen");
        }
      });
    } catch (e) {
      console.log(e);
    }
  }

  // Creates a level of buttons and calls itself to create the next level down for each button in that level
  displayfilterpart(parent, title, filter, groupby, start, end, theproject, billed, tag, client) {
    try {
      this.filterbuttons(parent, title, filter, start, end, theproject, billed, tag, client);

      if (groupby.length > 0) {
        const box = new Gtk.Box({
          orientation: 1,
          margin_start: 24,
        });
        parent.append(box);

        let newgroupby = [];
        if (groupby.length > 1) {
          for (let i = 1; i < groupby.length; i++) {
            newgroupby.push(groupby[i]);
          }
        }

        let groups = this.groupentries(filter, groupby[0]);

        for (let i = 0; i < groups.length; i++) {
          this.displayfilterpart(box, groups[i].title, groups[i].filter, newgroupby, start, end, theproject, billed, tag, client);
        }
      }
    } catch (e) {
      console.log(e);
    }
  }

  groupentries(filter, groupby) {
    try {
      let groups = [];

      if (groupby == "billed") {
        groups.push({title: "Billed", filter: [{duration: 0}]});
        groups.push({title: "Unbilled", filter: [{duration: 0}]});
        // Go through each entry in filter
        for (let i = 1; i < filter.length; i++) {
          let entry = entries[this.findindexbyID(filter[i].ID)];
          let duration = 0;
          if (entry.end) {
            duration = Math.floor((entry.end - entry.start) / 1000);
          }

          if (entry.billed) {
            groups[0].filter.push({ ID: entry.ID, duration: duration, });
            groups[0].filter[0].duration += duration;
          } else {
            groups[1].filter.push({ ID: entry.ID, duration: duration, });
            groups[1].filter[0].duration += duration;
          }
        }
        if (groups[1].filter.length < 2) {
          groups.splice(1, 1);
        } else if (groups[0].filter.length < 2) {
          groups.splice(0, 1);
        }

      } else if (groupby == "project") {

        for (let i = 1; i < filter.length; i++) {
          let entry = entries[this.findindexbyID(filter[i].ID)];
          let duration = 0;
          if (entry.end) {
            duration = Math.floor((entry.end - entry.start) / 1000);
          }

          const foundItem = groups.find(item => item.title === entry.project);
          if (foundItem) {
            const spot = groups.indexOf(foundItem);
            groups[spot].filter.push({ ID: entry.ID, duration: duration, });
            groups[spot].filter[0].duration += duration;
          } else {
            groups.push({title: entry.project, filter: [{duration: duration}, { ID: entry.ID, duration: duration, }]})
          }
        }

      } else if (groupby == "tag" || groupby == "client") {

        for (let i = 1; i < filter.length; i++) {
          let entry = entries[this.findindexbyID(filter[i].ID)];
          let duration = 0;
          if (entry.end) {
            duration = Math.floor((entry.end - entry.start) / 1000);
          }

          let tagsearch = " " + entry.project.replace(/[\r\n]+/g, ' ') + " ";
          if (entry.meta) {
            tagsearch += entry.meta.replace(/[\r\n]+/g, ' ') + " ";
          }
          let char = "#";
          if (groupby == "client") {
            char = "@";
          }

          let tags = [];
          for (let j = 0; j < tagsearch.length; j++) {
            j = tagsearch.indexOf(" " + char, j);
            if (j < 0) {
              break;
            } else {
              let tag = tagsearch.slice(j + 2);
              if (tag.slice(0, 1) != " ") {
                tag = char + tag.split(" ")[0].toLowerCase();
                if (!tags.includes(tag)) {
                  tags.push(tag);
                }
                j += tag.length + 2;
              } else {
                j += 2;
              }
            }
          }

          if (tags.length == 0) {
            let title = "(no " + groupby + ")";
            const foundItem = groups.find(item => item.title === title);
            if (foundItem) {
              const spot = groups.indexOf(foundItem);
              groups[spot].filter.push({ ID: entry.ID, duration: duration, });
              groups[spot].filter[0].duration += duration;
            } else {
              groups.unshift({title: title, filter: [{duration: duration}, { ID: entry.ID, duration: duration, }]})
            }
          } else {
            for (let j = 0; j < tags.length; j++) {
              const foundItem = groups.find(item => item.title === tags[j]);
              if (foundItem) {
                const spot = groups.indexOf(foundItem);
                groups[spot].filter.push({ ID: entry.ID, duration: duration, });
                groups[spot].filter[0].duration += duration;
              } else {
                groups.push({title: tags[j], filter: [{duration: duration}, { ID: entry.ID, duration: duration, }]})
              }
            }
          }
        }
      }

      return groups;
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

            // Decide whether to split
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

    // Edit the entry to match ((startDate && start < startDate) || (endDate && ((!end && now > endDate) || end > endDate)))
    const now = new Date();
    if (startDate && start < startDate) {
      await this.editentrybyIndex(index, theproject, startDate, end, billed, meta);
      await this.addentry(theproject, meta, start, new Date(startDate.getTime() - 1), billed, true, 0, index);
      index += 1;
      start = startDate;
    }
    if (endDate && (end > endDate || (!end && now > endDate))) {
      await this.editentrybyIndex(index, theproject, start, endDate, billed, meta);
      await this.addentry(theproject, meta, new Date(endDate.getTime() + 1), end, billed, true, 0, index + 1);
    }
  }

  async filterdetailsdialog(filteredentries, start, end, theproject, billed, tag, client) {
    try {
      const dialog = new Adw.AlertDialog({
        heading: "Details",
        body: "What would you like to do?",
        close_response: "cancel",
      });
      dialog.add_response("cancel", "Cancel");
      dialog.add_response("bulk", "Bulk Edit");
      dialog.add_response("export", "Export CSV");

      dialog.connect("response", (_, response_id) => {
        dialogsopen -= 1;
        if (response_id === "bulk") {
          this.bulkeditdialog(filteredentries, start, end);
        } else if (response_id === "export") {
          this.exporttocsv(filteredentries, start, end, theproject, billed, tag, client);
        }
      });

      dialogsopen += 1;
      dialog.present(this);

    } catch (e) {
      console.log(e);
    }
  }

  async bulkeditdialog(filteredentries, start, end) { //, start, end, theproject, billed, tag, client) {
    try {
      console.log("Preparing to bulk edit " + (filteredentries.length-1) + " entries between " + start + " and " + end);
      const dialog = new Adw.AlertDialog({
        heading: "Bulk Edit Entries",
        close_response: "cancel",
      });
      dialog.add_response("cancel", "Cancel");
      dialog.add_response("okay", "Apply Changes");

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
        dialogsopen -= 1;
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

          this.bulkeditentries(filteredentries, newproject, newbilled, start, end);
        }
      });

      dialog.present(this);
      dialogsopen += 1;
    } catch (e) {
      console.log(e);
    }
  }

  async groupdialog(report, tocall = null) {
    try {
      const dialog = new Adw.AlertDialog();
      dialog.add_response("cancel", "Cancel");
      dialog.add_response("okay", "OK");
      dialog.set_response_appearance("okay", Adw.ResponseAppearance.SUGGESTED);

      const box = new Gtk.Box({
        orientation: 1,
      });
      const listbox = new Gtk.ListBox({
        height_request: 24,
        margin_bottom: 6,
      });
      const style = listbox.get_style_context();
      style.add_class("boxed-list");
      const listbox2 = new Gtk.ListBox({
        height_request: 24,
      });
      const style2 = listbox2.get_style_context();
      style2.add_class("boxed-list");

      let titles = ["project", "billed", "tag", "client"];
      for (let i = 0; i < 4; i++) {
        let title = "";
        const row = new Adw.ActionRow();
        if (i < report.groupby.length) {
          title = report.groupby[i];
          titles.splice(titles.indexOf(title), 1);
          title = title.charAt(0).toUpperCase() + title.slice(1);
          row.title = title;
          listbox.append(row);
        } else {
          title = titles[0];
          titles.splice(0, 1);
          title = title.charAt(0).toUpperCase() + title.slice(1);
          row.title = title;
          listbox2.append(row);
        }
      }

      const controlbox = new Gtk.Box({
        orientation: 1,
        halign: 3,
      });
      const usebox = new Gtk.Box({
        halign: 3,
        margin_bottom: 6,
      });
      let usestyle = usebox.get_style_context();
      usestyle.add_class("linked");
      const movebox = new Gtk.Box({
        halign: 3,
        margin_bottom: 12,
      });
      let movestyle = movebox.get_style_context();
      movestyle.add_class("linked");
      const add = new Gtk.Button({
        label: "Add",
      });
      const remove = new Gtk.Button({
        label: "Remove",
      });
      const up = new Gtk.Button({
        label: "Move Up",
      });
      const down = new Gtk.Button({
        label: "Move Down",
      });
      usebox.append(add);
      usebox.append(remove);
      movebox.append(up);
      movebox.append(down);
      controlbox.append(movebox);
      controlbox.append(usebox);

      add.connect("clicked", () => {
        const selection = listbox2.get_selected_row();
        if (selection) {
          const row = new Adw.ActionRow({
            title: selection.get_title(),
          });
          listbox.append(row);
          listbox2.remove(selection);
        }
      });
      remove.connect("clicked", () => {
        const selection = listbox.get_selected_row();
        if (selection) {
          const row = new Adw.ActionRow({
            title: selection.get_title(),
          });
          listbox2.append(row);
          listbox.remove(selection);
        }
      });
      up.connect("clicked", () => {
        const selection = listbox.get_selected_row();
        if (selection) {
          let number = selection.get_index();
          if (number > 0) {
            const row = new Adw.ActionRow({
              title: selection.get_title(),
            });
            listbox.insert(row, number - 1);
            listbox.remove(selection);
            listbox.select_row(row);
          }
        }
      });
      down.connect("clicked", () => {
        const selection = listbox.get_selected_row();
        if (selection) {
          let number = selection.get_index();
          if (selection != listbox.get_last_child()) {
            const row = new Adw.ActionRow({
              title: selection.get_title(),
            });
            listbox.remove(selection);
            listbox.insert(row, number + 1);
            listbox.select_row(row);
          }
        }
      });

      box.append(listbox);
      box.append(controlbox);
      box.append(listbox2);

      dialog.set_extra_child(box);

      dialog.connect("response", (_, response_id) => {
        dialogsopen -= 1;
        if (response_id === "okay") {
          report.groupby = [];
          for (let i = 0; i < 4; i++) {
            const row = listbox.get_row_at_index(i);
            if (row) {
              let title = row.get_title();
              report.groupby.push(title.toLowerCase());
            }
          }
          if (tocall && typeof tocall === 'function') {
            tocall();
          }
        }
      });

      dialog.present(this);
      dialogsopen += 1;
    } catch (e) {
      console.log(e);
    }
  }

  async reportsdialog() {
    try {
      const dialog = new Adw.AlertDialog({
        heading: "Create and Edit Reports",
        close_response: "okay",
      });
      dialog.add_response("okay", "Done");
      dialog.set_response_appearance("okay", Adw.ResponseAppearance.SUGGESTED);

      const box = new Gtk.Box({
        orientation: 1,
      });
      const box1 = new Gtk.Box({
        halign: 3,
        margin_bottom: 12,
      });
      const boxstyle = box1.get_style_context();
      boxstyle.add_class("linked");

      const add = new Gtk.Button({
        icon_name: "list-add-symbolic",
      });
      add.connect("clicked", () => {
        this.reportdialog(null, (response) => {
          if (response == "okay") {
            const row = new Adw.ActionRow();
            row.title = reports[reports.length - 1].title;
            listbox.append(row);
          }
        });
      });

      box1.append(add);

      const edit = new Gtk.Button({
        icon_name: "timetracker-edit-symbolic",
      });
      edit.connect("clicked", () => {
        const selection = listbox.get_selected_row();
        if (selection) {
          let number = selection.get_index();
          if (number > -1) {
            this.reportdialog(reports[number + 1], (response) => {
              if (response == "okay") {
                const row = new Adw.ActionRow({
                  title: reports[number + 1].title,
                });
                listbox.remove(selection);
                listbox.insert(row, number);
                listbox.select_row(row);
              } else if (response == "delete") {
                listbox.remove(selection);
              }
            });
          }
        }
      });
      box1.append(edit);

      const up = new Gtk.Button({
        icon_name: "timetracker-up-symbolic",
      });
      up.connect("clicked", () => {
        const selection = listbox.get_selected_row();
        if (selection) {
          let number = selection.get_index();
          if (number > 0) {
            const row = new Adw.ActionRow({
              title: selection.get_title(),
            });
            listbox.insert(row, number - 1);
            listbox.remove(selection);
            listbox.select_row(row);
            if (number > 0 && number < reports.length - 1) {
              [reports[number], reports[number + 1]] = [reports[number + 1], reports[number]];
            }
            this.updatereports();

            let reportstowrite = [];
            for (let i = 1; i < reports.length; i++) {
              if (!reports[i].deleted) { // This if is probably not needed
                reportstowrite.push(reports[i]);
              }

            }
            this._settings.set_string("reports", this.reportstosettings(reportstowrite));
          }
        }
      });
      box1.append(up);

      const down = new Gtk.Button({
        icon_name: "timetracker-down-symbolic",
      });
      down.connect("clicked", () => {
        const selection = listbox.get_selected_row();
        if (selection) {
          let number = selection.get_index();
          if (selection != listbox.get_last_child()) {
            const row = new Adw.ActionRow({
              title: selection.get_title(),
            });
            listbox.remove(selection);
            listbox.insert(row, number + 1);
            listbox.select_row(row);
            if (number => 0 && number < reports.length - 2) {
              [reports[number + 1], reports[number + 2]] = [reports[number + 2], reports[number + 1]];
            }
            this.updatereports();

            let reportstowrite = [];
            for (let i = 1; i < reports.length; i++) {
              if (!reports[i].deleted) { // This if is probably not needed
                reportstowrite.push(reports[i]);
              }

            }
            this._settings.set_string("reports", this.reportstosettings(reportstowrite));
          }
        }
      });
      box1.append(down);

      box.append(box1);

      const listbox = new Gtk.ListBox({
        height_request: 24,
        margin_bottom: 6,
      });
      const style = listbox.get_style_context();
      style.add_class("boxed-list");

      //let reportbuttons = [];
      for (let i = 1; i < reports.length; i++) {
        if (!reports[i].deleted) { // if is not needed, right?
          const report = reports[i];
          const row = new Adw.ActionRow();
          row.title = report.title;
          listbox.append(row);
        }
      }
      box.append(listbox);

      dialog.set_extra_child(box);

      dialog.connect("response", (_, __) => {
        dialogsopen -= 1;
      });

      dialog.present(this);
      dialogsopen += 1;
    } catch (e) {
      console.log(e);
    }
  }

  reportdialog(report, tocall = null) {
    try {
      let newreport = false;
      if (report == null) {
        newreport = true;
        report = {title: "", start: null, end: null, filters: [ { project: null, billed: null, tag: null, client: null } ], groupby: [], };
      }

      const dialog = new Adw.AlertDialog({
        heading: "Edit Report",
        close_response: "cancel",
      });
      dialog.add_response("cancel", "Cancel");
      dialog.add_response("okay", "OK");
      dialog.set_response_appearance("okay", Adw.ResponseAppearance.SUGGESTED);

      const box = new Gtk.Box({
        orientation: 1,
      });
      const entry = new Gtk.Entry({
        placeholder_text: "Title",
        margin_bottom: 12,
      });
      entry.set_text(report.title);
      box.append(entry);
      box.append(this.reportcontrols(report));
      
      const deleteb = new Gtk.ToggleButton({
        margin_top: 12,
      });
      if (!newreport) {
        const deletebcontent = new Adw.ButtonContent({
          label: "Delete",
          icon_name: "user-trash-symbolic",
        });
        deleteb.set_child(deletebcontent);
        deleteb.connect("toggled", () => {
          let style = deleteb.get_style_context();
          if (deleteb.get_active()) {
            style.add_class("destructive-action");
          } else {
            if (style.has_class("destructive-action")) {
              style.remove_class("destructive-action");
            }
          }
        });
        box.append(deleteb);
      }

      dialog.set_extra_child(box);

      dialog.connect("response", (_, response_id) => {
        dialogsopen -= 1;
        if (response_id === "okay") {
          if (!deleteb.get_active()) {
            if (newreport) {
              reports.push(report);
            }
            report.title = entry.get_text();
            this.updatereports();
          } else {
            report.deleted = true;
            const foundItem = reports.find(item => item.deleted === true);
            if (foundItem) {
              reports.splice(reports.indexOf(foundItem), 1);
            }
            this.updatereports();
          }
        } else if (response_id == "cancel" && report == null) {
          report = {deleted: true};
        }
        let reportstowrite = [];
        for (let i = 1; i < reports.length; i++) {
          if (!reports[i].deleted) { // This if is probably not needed
            reportstowrite.push(reports[i]);
          }
        }
        this._settings.set_string("reports", this.reportstosettings(reportstowrite));
        if (tocall && typeof tocall === 'function') {
          if (!deleteb.get_active()) {
            tocall(response_id);
          } else {
            tocall("delete");
          }
        }
      });

      dialog.present(this);
      dialogsopen += 1;
    } catch (e) {
      console.log(e);
    }
  }

  async reportfiltersdialog(report, tocall = null) {
    try {
      const dialog = new Adw.AlertDialog({
        heading: "Choose Filters",
        close_response: "cancel",
      });
      dialog.add_response("cancel", "Cancel");
      dialog.add_response("okay", "OK");
      dialog.set_response_appearance("okay", Adw.ResponseAppearance.SUGGESTED);

      const box = new Gtk.Box({
        orientation: 1,
      });
      const projectlist2 = new Gtk.DropDown({
        enable_search: true,
        margin_bottom: 12,
      });
      projectlist2.expression = listexpression;
      const model2 = new Gio.ListStore({ item_type: project });
      projectlist2.model = model2;
      model2.append(new project({ value: "(All Projects)" }));
      for (let i = 0; i < projects.length; i++) {
        model2.append(new project({ value: projects[i] }));
      }
      box.append(projectlist2);

      const sep1 = new Gtk.Separator({
        margin_bottom: 12,
      });
      const sep2 = new Gtk.Separator({
        margin_bottom: 12,
      });
      const sep3 = new Gtk.Separator({
        margin_bottom: 12,
      });
      box.append(sep1);

      if (report.filters.project) {
        let projectindex = projects.indexOf(report.filters.project);
        if (projectindex !== -1) {
          projectlist2.set_selected(projectindex + 1);
        }
      }

      let billednull = new Gtk.CheckButton({
        label: "Billed and Not Billed",
      });
      let billedtrue = new Gtk.CheckButton({
        label: "Billed",
        group: billednull,
      });
      let billedfalse = new Gtk.CheckButton({
        label: "Not Billed",
        group: billednull,
        margin_bottom: 12,
      });
      box.append(billednull);
      box.append(billedtrue);
      box.append(billedfalse);
      box.append(sep2);

      if (report.filters.billed) {
        billedtrue.set_active(true);
      } else if (report.filters.billed == false) {
        billedfalse.set_active(true);
      } else {
        billednull.set_active(true);
      }

      const tagentry = new Gtk.Entry({
        placeholder_text: "Tag",
        margin_bottom: 12,
      })
      if (report.filters.tag) {
        tagentry.set_text(report.filters.tag);
      }
      const cliententry = new Gtk.Entry({
        placeholder_text: "Client",
      })
      if (report.filters.client) {
        cliententry.set_text(report.filters.client);
      }
      box.append(tagentry);
      box.append(sep3);
      box.append(cliententry);

      dialog.set_extra_child(box);

      dialog.connect("response", (_, response_id) => {
        dialogsopen -= 1;
        if (response_id === "okay") {
          let newproject = null;
          const selection = projectlist2.selected_item;
          const value = selection.value;
          if (projectlist2.get_selected() > 0) {
            newproject = value;
          }
          report.filters.project = newproject;
          let newbilled = null;
          if (billedtrue.get_active()) {
            newbilled = true;
          } else if (billedfalse.get_active()) {
            newbilled = false;
          }
          report.filters.billed = newbilled;
          let newtag = null;
          if (tagentry.get_text() != "") {
            newtag = tagentry.get_text();
          }
          report.filters.tag = newtag;
          let newclient = null;
          if (cliententry.get_text() != "") {
            newclient = cliententry.get_text();
          }
          report.filters.client = newclient;

          if (tocall && typeof tocall === 'function') {
            tocall();
          }
        }
      });

      dialog.present(this);
      dialogsopen += 1;
    } catch (e) {
      console.log(e);
    }
  }

  async reportdatedialog(date = new Date(), tocall = null, start = true) {
    try {
      let selecteddate = null;

      const dialog = new Adw.AlertDialog({
        heading: "Choose the Date & Time",
        close_response: "cancel",
      });
      dialog.add_response("cancel", "Cancel");
      dialog.add_response("okay", "OK");
      dialog.set_response_appearance("okay", Adw.ResponseAppearance.SUGGESTED);

      const box0 = new Gtk.Box({
        orientation: 1,
        hexpand: true,
      });
      const nodate = new Gtk.CheckButton({
        active: true,
        label: "No Date",
        margin_bottom: 12,
      });
      const relativedate = new Gtk.CheckButton({
        label: "Relative Date",
        group: nodate,
      });
      const specificdate = new Gtk.CheckButton({
        label: "Specific Date:",
        group: nodate,
      });

      const frame1 = new Gtk.Frame({
        margin_bottom: 12,
      });
      const box = new Gtk.Box({
        margin_start: 12,
        margin_end: 12,
        margin_top: 12,
        margin_bottom: 12,
        orientation: 1,
        spacing: 6,
      });
      frame1.set_child(box);
      const box1 = new Gtk.Box({
        spacing: 6,
      });
      const box2 = new Gtk.Box({
        spacing: 6,
      });
      box.append(box1);
      box.append(box2);
      const entry = new Gtk.Entry({
        text: "0",
      });
      entry.connect("changed", () => {
        relativedate.set_active(true);
      });

      const intervallabel = new Gtk.Label({
        label: "today",
      });
      const intervallist = new Gtk.StringList();
      intervallist.splice(0, 0, ["day(s)", "week(s)", "month(s)", "year(s)"]);
      const intervaldrop = new Gtk.DropDown({
        model: intervallist,
      });
      intervaldrop.connect("notify::selected-item", () => {
        const selection = intervaldrop.get_selected();
        if (selection == 0) {
          intervallabel.label = "today";
        } else if (selection == 1) {
          intervallabel.label = "this week";
        }else if (selection == 2) {
          intervallabel.label = "this month";
        }else if (selection == 3) {
          intervallabel.label = "this year";
        }
        relativedate.set_active(true);
      });

      const directionlist = new Gtk.StringList();
      directionlist.splice(0, 0, ["before", "after"]);
      const directiondrop = new Gtk.DropDown({
        model: directionlist,
      });
      directiondrop.connect("notify::selected-item", () => {
        relativedate.set_active(true);
      });
      box1.append(entry);
      box1.append(intervaldrop);
      box2.append(directiondrop);
      box2.append(intervallabel);

      const frame2 = new Gtk.Box({
        hexpand: true,
      });
      const datebutton = new Gtk.Button({
        label: "No Date",
        halign: 2,
        hexpand: true,
      });
      frame2.append(specificdate);
      frame2.append(datebutton);
      datebutton.connect("clicked", () => {
        let newdate = null;
        if (!selecteddate) {
          newdate = new Date();
          if (start) {
            newdate.setHours(0,0,0,0);
          } else {
            newdate.setHours(23,59,59,999);
          }
        } else {
          newdate = new Date(selecteddate);
        }
        this.datedialog(newdate, (date) => {
          datebutton.set_label(this.datetotext(date));
          selecteddate = date;
          if (date != newdate) {
            specificdate.set_active(true);
          }
        }, null);
      });

      // Set order of top-level widgets
      box0.append(nodate);
      box0.append(relativedate);
      box0.append(frame1);
      //box0.append(specificdate);
      box0.append(frame2);

      // Set content of widgets
      if (!date) {
        // no date
      } else if (isNaN(date)) {
        // relative date
        relativedate.set_active(true);
        let a = [];
        //let add = true;
        if (date.indexOf("+") > -1) {
          a = date.split("+");
          directiondrop.set_selected(1);
        } else if (date.indexOf("-") > -1) {
          a = date.split("-");
          directiondrop.set_selected(0);
          //add = false;
        }
        if (a[0] == "day") {
          intervaldrop.set_selected(0);
        } else if (a[0] == "week") {
          intervaldrop.set_selected(1);
        } else if (a[0] == "month") {
          intervaldrop.set_selected(2);
        } else if (a[0] == "year") {
          intervaldrop.set_selected(3);
        }
        entry.set_text(parseInt(a[1]).toString());
      } else {
        selecteddate = date;
        specificdate.set_active(true);
        datebutton.set_label(this.datetotext(date));
      }

      dialog.set_extra_child(box0);
      dialog.connect("response", (_, response_id) => {
        dialogsopen -= 1;
        if (response_id === "okay") {
          if (relativedate.get_active()) {
            if (intervaldrop.get_selected() == 1) {
              selecteddate = "week";
            } else if (intervaldrop.get_selected() == 2) {
              selecteddate = "month";
            } else if (intervaldrop.get_selected() == 3) {
              selecteddate = "year";
            } else {
              selecteddate = "day";
            }
            if (directiondrop.get_selected() == 1) {
              selecteddate += "+";
            } else {
              selecteddate += "-";
            }
            if (!isNaN(entry.get_text())) {
              selecteddate += entry.get_text();
            } else {
              selecteddate += "0";
            }
          } else if (nodate.get_active()) {
            selecteddate = null;
          }
          if (tocall && typeof tocall === 'function') {
            tocall(selecteddate);
          }
          return selecteddate;
        }
      });

      dialog.present(this);
      dialogsopen += 1;
    } catch (e) {
      console.log(e);
    }
  }

  // Allows choosing an ending date by choosing a duration
  async durationdialog(startDate, endDate, tocall = null) {
    try {
      let end = new Date();
      if (endDate != null) {
        end = endDate;
      }
      let duration = this.calcTimeDifference(startDate, end, false);

      const dialog = new Adw.AlertDialog({
        heading: "Choose the Duration",
        close_response: "cancel",
      });

      dialog.add_response("cancel", "Cancel");
      dialog.add_response("okay", "OK");
      dialog.set_response_appearance("okay", Adw.ResponseAppearance.SUGGESTED);

      const box = new Gtk.Box({
        orientation: 1,
        spacing: 6,
      });
      const timebox = new Gtk.Box({
        orientation: 0,
        spacing: 0,
      });
      let timestyle = timebox.get_style_context();
      timestyle.add_class("linked");
      
      const bottombox = new Gtk.Box({
        orientation: 1,
        spacing: 6,
      });
      box.append(bottombox);

      const hourminuteentry = new Gtk.Entry();
      const hourminutelabel = new Gtk.Label();
      const secondentry = new Gtk.Entry();

      let inputhour = Math.floor(duration / 3600);
      let inputminutes = Math.floor((duration - (inputhour * 3600)) / 60);
      let inputseconds = duration - (inputhour * 3600) - (inputminutes * 60);

      let hourString = ((inputhour * 100) + inputminutes).toString();
      if (inputhour < 1) {
        hourString = "0" + this.intto2digitstring(inputminutes);
      }
      hourminuteentry.set_text(hourString);

      secondentry.set_text(this.intto2digitstring(inputseconds));

      hourminutelabel.label = "Hours & minutes, e.g., (\"1130\")";

      timebox.append(hourminuteentry);
      timebox.append(secondentry);
      bottombox.append(hourminutelabel);
      bottombox.append(timebox);

      dialog.set_extra_child(box);

      dialog.connect("response", (_, response_id) => {
        dialogsopen -= 1;
        if (response_id === "okay") {
          let chosendate = new Date(startDate);

          let hourminute = hourminuteentry.get_text();
          let secondtext = secondentry.get_text();
          if (hourminute != "" && secondtext != "") {
            let hour = 0;
            let minute = 0;
            if (hourminute.length > 2) {
              hour = Math.floor(parseInt(hourminute) / 100);
              minute = parseInt(hourminute) - (hour * 100);
            } else {
              hour = parseInt(hourminute);
            }
            let second = parseInt(secondtext);
            if (isNaN(second)) {
              second = 0;
            }
            let seconds = second + (minute * 60) + (hour * 3600);
            if (isNaN(seconds)) {
              seconds = 0;
            }
            chosendate.setSeconds(chosendate.getSeconds() + seconds);
          } else {
            chosendate = null;
          }

          // If a callback function was given, call that function with the discovered date
          if (tocall && typeof tocall === 'function') {
            tocall(chosendate);
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
      dialogsopen += 1;
    } catch (e) {
      console.log(e);
    }
  }

  async datedialog(date = new Date(), tocall = null, body = null, allownodate = false) {
    try {
      let ampm = this._settings.get_boolean("ampmformat");
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
        orientation: 1,
        spacing: 6,
      });
      box.append(topbox);
      const bottombox = new Gtk.Box({
        orientation: 1,
        spacing: 6,
      });
      box.append(bottombox);
      const buttonbox = new Gtk.Box({
        orientation: 0,
        spacing: 6,
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

      const am = new Gtk.ToggleButton();
      const pm = new Gtk.ToggleButton();
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
        hourString = "0" + this.intto2digitstring(date.getMinutes());
      }
      hourminuteentry.set_text(hourString);

      /* can't seem to focus the entry or get when it is edited {{{
      hourminuteentry.connect("notify::key-press-event", () => {
        secondentry.set_text("00");
      });
      */
      secondentry.set_text(this.intto2digitstring(date.getSeconds()));

      hourminutelabel.label = "Hours & minutes, e.g., (\"1130\")";

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
        dialogsopen -= 1;
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
          chosendate.setMonth(monthlist.get_selected());
          chosendate.setFullYear(yearspin.get_text());
          // This line MUST follow month and year, since otherwise, a day of greater value than the chosendate's original month's number of days could cause a problem.
          chosendate.setDate(dayspin.get_value());
          
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
          return chosendate;
        } else if (response_id == "none") {
          if (tocall && typeof tocall === 'function') {
            tocall(null);
          }
          return null;
        }
      });

      dialog.present(this);
      dialogsopen += 1;
    } catch (e) {
      console.log(e);
    }
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
  
  datetodaytitle(date) {
    try {
      const today = new Date();
      today.setHours(0,0,0,0);
      const current = new Date(date)
      current.setHours(0,0,0,0);
      
      let dateString = "";
      
      if (date.getTime() === today.getTime()) {
        dateString = "Today, ";
      }
      
      dateString += date.toString();
      const year = date.getFullYear().toString();

      const index = dateString.indexOf(year);
      dateString = dateString.slice(0, index + year.length);

      return dateString;
    } catch (e) {
      console.log(e);
    }
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
              // Remove any old deletions
              // Create date that is two days ago
              let del = new Date();
              del.setDate(del.getDate() - 2);

              if (entry.end > del) {
                sync_extraentries.push({ID: entry.ID, end: entry.end});
              }
            } else {
              // Assign the dateless deletion a date
              sync_extraentries.push({ID: entry.ID, end: new Date()});
            }
          }
        }
        if (!merge) {
          // Set the visible log contents
          //this.logmodel.splice(0, modelLength, new_items);
          this.updatelog();

          // Start logging timer for the latest still running entry
          if (latestStartIndex > -1) {
            this.startTimer(latestStartIndex, latestStartDate);
            // Set that entry as [logging]
            let new_item = "[logging] | Project: " + entries[latestStartIndex].project;

            if (entries[latestStartIndex].meta) {
              new_item += "\n" + entries[latestStartIndex].meta;
            }
            //this.logmodel.splice(entries.length - 1 - latestStartIndex, 1, [new_item]);
            this.updatelog();
          }
        } else {
          // Add to the visible log contents
          
          //this.logmodel.splice(0, 0, new_items);

          if (!logging) {
            // Start logging timer for the latest still running entry
            if (latestStartIndex > -1) {
              this.startTimer(latestStartIndex + modelLength, latestStartDate);
              // Set that entry as [logging]
              
              //this.logmodel.splice(entries.length - 1 - latestStartIndex, 1, ["[logging] | Project: " + entries[latestStartIndex].project]);
            }
          } else {
            // Check if the latestStart is later than the currently logging entry
            let current = this.currentTimer();
            if (current) {
              if (entries[current].start < latestStartDate) {
                // Set that entry as [???????]
                
                //this.logmodel.splice(entries.length - 1 - current, 1, ["[???????] | Project: " + entries[current].project]);
                this.stopTimer();

                this.startTimer(latestStartIndex + modelLength, latestStartDate);
                // Set that entry as [logging]
                
                //this.logmodel.splice(entries.length - 1 - current, 1, ["[logging] | Project: " + entries[current].project]);
                this.updatelog();
              }
            }
          }
          this.updatelog();
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
              console.log(entries[spot]);
              console.log(entry);
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
        
        // update the log
        this.updatelog();
        
      } catch (e) {
        console.log(e);
      }
      this.updatereports();
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

  // Reads a CSV text into an array. Written for Time Tracker, but not specific to it
  // Depends on `splitplus()`, a `split()` method with more features
  // Only returns something if there's more than one line in `text`
  async readcsv(text) {
    let result = [];

    // Get lines, using `splitplus()`, which accounts for quotation marks
    let lines = this.splitplus(text, '\n');

    // Get columns from the first line in the file
    let columns = this.splitplus(lines[0], ',');

    // Separate it out based on lines and columns
    if (lines.length > 1) {
      for (let i = 1; i < lines.length; i++) {
        if (lines[i] != "") {
          // Get cell strings, using `splitplus()`, which accounts for quotation marks
          let strings = this.splitplus(lines[i], ',');
          
          let entry = {};
          for (let j = 0; j < columns.length; j++) {
            let cell = "";
            try {
              // If there's a strings[j], assign it to `cell`
              cell = strings[j];

              // But that's not enough, because we might end up with the wrong number of quotation marks
              // So now let's remove any quotation marks that surround information in the cell
              
              // Find the beginning quote
              let first = cell.indexOf('"');
              if (first > -1) {
                // Turns out a quotation mark is found. Remove it.
                if (first == 0) {
                  cell = cell.slice(1, cell.length);
                } else {
                  cell = cell.slice(0, first) + cell.slice(first + 1, cell.length);
                }
                
                // Find the ending quote and remove it
                let last = cell.lastIndexOf('"');
                if (last == cell.length - 1) {
                  cell = cell.slice(0, cell.length - 1);
                } else if (last > -1) {
                  cell = cell.slice(0, last) + cell.slice(last + 1, cell.length);
                }
                
                // If there are any remaining quotation marks, make two characters into one, per the CSV specifications
                cell = cell.replace(/""/g, '"');
              }
            } catch (_) {}
            entry[columns[j]] = cell;
          }
          result.push(entry);
        }
      }
    }
    return result;
  }

  // Much like the `split()` method, but with some additional features
  // If the separator appears within quotation marks, it's not counted
  // `cleanquotes` indicates whether to remove quotation marks
  splitplus(text, separator, cleanquotes = false) {
    let result = [""];
    
    // This variable is used to clean or not clean quotes
    let clean = 0;
    if (cleanquotes) {
      clean = 1;
    }

    try {
      // Defining the starting and ending index variables, and a `stop` variable
      let starti = 0;
      let endi = 0;
      let stop = false;
      
      /* The following `for` loop essentially leapfrogs `starti` and `endi` over
         each other in order to find out which instances of `separator` matter */
      for (let i = 0; i < text.length; i++) {
        // Commas matter from `starti` until the first quote after it
        endi = text.indexOf('"', starti);
        if (endi == -1) {
          /* If there is no opening quote until the end of `text`, then 
             we'll treat the end as the opening quote, and signal to stop here */
          endi = text.length + 1;
          stop = true;
        }
        
        // Now let's make use of our knowledge of `starti` and `endi`
        if (endi > starti) {
          // This should always be true, but it's best to be sure
          // Get the chunk of text that matters
          let chunk = text.slice(starti, endi);
          // Split it up
          let segments = chunk.split(separator);
          
          // Add the first segment to the previous item
          result[result.length - 1] += segments[0];
          // If there are more segments, push them to the array
          if (segments.length > 1) {
            result.push(...segments.slice(1));
          }
        }
        if (!stop) {
          // If we have NOT been signaled to stop reading the string at this point
          // Find the next closing quote. The +1s are important so that we jump over the quotes
          starti = text.indexOf('"', endi + 1) + 1;
          if (starti == 0) {
            console.log("Malformed file: No closing quotation mark. This is a non-critical issue, but you might want to fix the file.");
            // Signal it to stop once we've gone through this next chunk
            stop = true;
            // Set `starti` to the end of the text
            starti = text.length + clean;
          }
          // Now we deal with the chunk that we can't split up using `separator` due to it being in quotes
          if (starti > endi) {
            // If there is actually a chunk, add it to the last item in `result[]`
            result[result.length - 1] += text.slice(endi + clean, starti - clean);
          } else if (starti == endi + 1 && clean == 1) {
            // (I think) If we've reached the end of the text, and we're not cleaning quotes, give a closing quote
            result[result.length - 1] += '"';
          }
        } else {
          // If we HAVE been signaled to stop reading the string at this point
          break;
        }
      }
    } catch (e) {
      console.log(e);
    }

    return result;
  }

  // Parse an array of objects that represent lines in a CSV file, into TT's `entries` array format
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
      if (thepath != logpath || !filelost) {

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

      } else if (thepath == logpath && filelost) {
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
      if (!filelost) {
        filelost = true;
        console.log("Cannot find file " + logpath);
        this.stopsynctimer();
        if (sync_autotemplog) {
          await this.settempfile(text, true);
        } else {
          await this.newfilenotfounddialog(logpath, text, true);
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
    // Create a backup of the temporary log
    // "backup_2024-01-23-145243523.csv"
    console.log("Log has been found again!");
    this._toast_overlay.add_toast(Adw.Toast.new(`Log has been found again. Merging temporary and original.`));
    filelost = false;
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

  async newfilenotfounddialog(thepath, text = "", filehasbeenopened = false) {
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
      dialogsopen -= 1;
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
    dialogsopen += 1;
    this.filecheck = setInterval(() => {
      const file = Gio.File.new_for_path(logpath);
      // If the file exists
      const fileexists = file.query_exists(null);
      if (fileexists) {
        clearInterval(this.filecheck);
        filelost = false;
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
        await this.writetofile(sync_templogpath, text);
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

  closefirstusedialog() {
    this._stack.set_visible_child_name("page1");
    this._switcher_title.set_sensitive(true);
    this._menu.set_sensitive(true);
    dialogsopen -= 1;
  }

  firstusedialog() {
    dialogsopen += 1;
    this._switcher_title.set_sensitive(false);
    this._menu.set_sensitive(false);
    this._stack.set_visible_child_name("page3");
  }

  // Set the log path as `{home}/.local/share/time-tracker/log.csv`
  async usesystemfolder() {
    this.stopsynctimer();
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
      //await this.readfromfile();
    }
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
          await this.writelog(filepath + "/" + todaysname, null, false);
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
});
