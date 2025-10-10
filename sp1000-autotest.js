/* Protocol meta info:
<NAME> SP1000G Autotest </NAME>
<DESCRIPTION>
An autotest script for SP1000G that use the pattern generator to toggle all channels and ensure the system 
is functional.
</DESCRIPTION>
<VERSION> 0.1 </VERSION>
<AUTHOR_NAME>  Ibrahim KAMAL </AUTHOR_NAME>
<AUTHOR_URL> i.kamal@ikalogic.com </AUTHOR_URL>
<HELP_URL> https://github.com/ikalogic/ScanaStudio-scripts-v3/wiki </HELP_URL>
<COPYRIGHT> Ibrahim KAMAL </COPYRIGHT>
<LICENSE>    This code is distributed under the terms of the GNU General Public License GPLv3 </LICENSE>
<RELEASE_NOTES>
V0.1:  Initial release.
</RELEASE_NOTES>
*/

function on_draw_gui_pattern_generator() {
    ScanaStudio.console_info_msg("on_draw_gui_pattern_generator");
    ScanaStudio.gui_add_info_label("This pattern generator is used for SP1000G autotest.\n\r" +
        "It will toggle all channels in order to ensure the system is functional. \n\r" +
        "Connect a standard 9 channel probe to one of the SP1000G ports (E.g. PORT A) and launch the pattern generator." +
        "You should see a similar toggeling pattern on all channels.");

    ScanaStudio.gui_add_info_label("Note: Keep the probes floating (not connected to anything) during this autotest.");
}
function on_eval_gui_pattern_generator() {
    ScanaStudio.console_info_msg("on_eval_gui_pattern_generator");
    return "";
}
function on_pattern_generate() {
    ScanaStudio.console_info_msg("on_pattern_generate");

    var N_MAX = 1 << 9;
    var n_sample = 10;
    var N_CHUNK = 1;

    //init ch
    for (var ch = 0; ch < ScanaStudio.get_device_channels_count(); ch++) {
        ScanaStudio.builder_set_out_voltage(ch, 3300);
        ScanaStudio.builder_set_idle_state(ch, 1);
        ScanaStudio.builder_set_io(ch, ScanaStudio.io_type.push_pull);
    }


    for (var repeat = 1; repeat <= N_CHUNK; repeat++) {

        var tab = [];
        var tab1 = [];
        for (var ch = 0; ch < ScanaStudio.get_device_channels_count(); ch++) {
            if (ch % 2 == 0) {
                tab.push(1);
                tab1.push(0);
            }
            else {
                tab.push(0);
                tab1.push(1);
            }
        }

        ScanaStudio.builder_loop_start(10);
        for (var p = 5; p < 100; p += 5) {
            ScanaStudio.builder_add_step(tab, p);
            ScanaStudio.builder_add_step(tab1, p);
        }
        ScanaStudio.builder_loop_end();

        ScanaStudio.builder_start_chunk();
        ScanaStudio.builder_wait_done();
    }
}