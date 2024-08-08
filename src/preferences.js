// Perform the necessary imports
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';

// Creating the "project" class for displaying in the projectlist item
const project2 = GObject.registerClass(
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
  class project2 extends GObject.Object {},
);

// Declaring the project content model
const model = new Gio.ListStore({ item_type: project2 });
const listexpression = Gtk.PropertyExpression.new(project2, null, "value");

// Creating the main window of Time Tracker
export const PreferencesWindow = GObject.registerClass({
  GTypeName: 'PreferencesWindow',
  Template: 'resource:///com/lynnmichaelmartin/TimeTracker/preferences.ui',
  InternalChildren: ['firstday', 'importprojects', 'ampm', 'templogs'],
}, class PreferencesWindow extends Adw.ApplicationWindow {

  // Connecting with the gsettings for Time Tracker
  _settings = new Gio.Settings({ schemaId: 'com.lynnmichaelmartin.TimeTracker' });

  constructor() {
    super();

    this._firstday.set_selected(this._settings.get_int("firstdayofweek"));
    this._firstday.connect("notify::selected-item", () => {
      this._settings.set_int("firstdayofweek", this._firstday.get_selected());
    });
    this._settings.bind("addprojectsfromlog", this._importprojects, "active", Gio.SettingsBindFlags.DEFAULT);
    this._settings.bind("ampmformat", this._ampm, "active", Gio.SettingsBindFlags.DEFAULT);
    this._settings.bind("autotemplog", this._templogs, "active", Gio.SettingsBindFlags.DEFAULT);
  }
});
