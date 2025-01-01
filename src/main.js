
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk?version=4.0';
import Adw from 'gi://Adw?version=1';

import { TimeTrackerWindow } from './window.js';

pkg.initGettext();
pkg.initFormat();


export const TimeTrackerApplication = GObject.registerClass(
    class TimeTrackerApplication extends Adw.Application {
        constructor() {
            super({application_id: 'com.lynnmichaelmartin.TimeTracker', flags: Gio.ApplicationFlags.DEFAULT_FLAGS});

            this.set_accels_for_action('win.open', [ '<Ctrl>o' ]);
            this.set_accels_for_action('win.new', [ '<Ctrl>n' ]);
            this.set_accels_for_action('win.import', [ '<Ctrl>m' ]);
            this.set_accels_for_action('win.undo', [ '<Ctrl>z' ]);
            this.set_accels_for_action('win.redo', [ '<Ctrl>y' ]);
            this.set_accels_for_action('win.start', [ '<Ctrl>space' ]);

            const quit_action = new Gio.SimpleAction({name: 'quit'});
                quit_action.connect('activate', action => {
                this.quit();
            });
            this.add_action(quit_action);
            this.set_accels_for_action('app.quit', ['<primary>q']);

            const show_about_action = new Gio.SimpleAction({name: 'about'});
            show_about_action.connect('activate', action => {
                let aboutParams = {
                    transient_for: this.active_window,
                    application_name: 'time-tracker',
                    application_icon: 'com.lynnmichaelmartin.TimeTracker',
                    developer_name: 'Lynn Martin',
                    version: '2.0.3',
                    developers: [
                        'Lynn Martin'
                    ],
                    copyright: '© 2024 Lynn Martin. Licensed under the MIT-0 no attribution license.'
                };
                const aboutWindow = new Adw.AboutWindow(aboutParams);
                aboutWindow.present();
            });
            this.add_action(show_about_action);
        }

        vfunc_activate() {
            let {active_window} = this;

            if (!active_window)
                active_window = new TimeTrackerWindow(this);

            active_window.present();
        }
    }
);

export function main(argv) {
    const application = new TimeTrackerApplication();
    return application.runAsync(argv);
}
