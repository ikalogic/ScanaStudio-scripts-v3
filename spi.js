/* Script meta info:
<NAME> SPI </NAME>
<DESCRIPTION>
Highly configurable SPI bus decoder
</DESCRIPTION>
<VERSION> 1.86 </VERSION>
<AUTHOR_NAME>  Vladislav Kosinov, Ibrahim Kamal </AUTHOR_NAME>
<AUTHOR_URL> mailto:v.kosinov@ikalogic.com </AUTHOR_URL>
<HELP_URL> https://github.com/ikalogic/ScanaStudio-scripts-v3/wiki/SPI-script-documentation </HELP_URL>
<COPYRIGHT> Copyright IKALOGIC SAS 2019 </COPYRIGHT>
<LICENSE>  This code is distributed under the terms of the GNU General Public License GPLv3 </LICENSE>
<RELEASE_NOTES>
v1.86: Fix bug related to trigger with various CPOL/CPHA options.
v1.85: Fix bug related to decode without CS (Slave Select) line.
v1.84: Fix bug related to decode without CS (Slave Select) line.
v1.83: Add option to decode without CS (Slave Select) line.
v1.82: Fix a bug in "trigger on specific word".
v1.81: Fix a problem that caused error in decoding with CPHA = 1 (introduced by V1.80)
v1.80: Script now uses the much faster "sync_decode" function (2 to 3 times faster decoding).
v1.79: Fixed a bug that force unused channels to clear their name.
v1.78: Fixed a bug that caused a false warning about a "missing CS leading edge".
V1.77: Added dec_item_end() for each dec_item_new().
V1.76: Fixed bug in binary format display
V1.75: Fixed bug in trigger sequence builder
V1.74: Added support for GUI evaluation
V1.73: Added support for Dual/Quad SPI modes
V1.72: Migrated to new V3 API
V1.71: Fix bug that caused decodering to fail if CS is ignored.
V1.70: Fix decoding issue with missing CS signal at the start
V1.69: Fix PacketView packets search iisue
V1.68: Fix the last byte/word not being decoded
V1.67: BugFix: Decoding stops after an invalid frame
V1.66: Add light packet capabilities
V1.65: Completely reworked PacketView
V1.62: Better progress reporting, better demo mode generator, better PacketView
V1.61: Upgrade PacketView
V1.60: Fixed bug in SPI decoder and improve display
V1.59: Fixed bug in SPI decoder when CS is not valide
V1.58: Fixed bug in SPI generator, thanks to user Camille
V1.57: Added ScanaStudio 2.3xx compatibility.
V1.56: Added generator capability
V1.55: New options for trigger part
V1.54: Trigger fix
V1.53: Added decoder trigger
V1.52: Added demo signal building capability
V1.50: Better handling of probable noize on CS line (e.g. during system power up)
V1.49: Enhanced the way hex data is displayed in packet view (Thanks to user 0xdeadbeef)
V1.48: Corrected a bug in the way decoded data is displayed
V1.47: Better drawing of decoded items on the wavefrom (better alignment).
V1.46: Fixed a bug that caused some SPI modes to be incorrectly decoded. (By I.Kamal)
V1.45: Corrected another bug related to the option to ignore CS line. (By I.Kamal)
V1.44: Corrected a bug related to the option to ignore CS line. (By I.Kamal)
V1.42: Added the ability to ignore the CS line (for 2 wire SPI mode)
V1.41: Added the ability to decode even if the first CS edge is missing
V1.30: Added Packet/Hex View support.
V1.26: Added the possibility (option) to ignore MOSI or MISO line
V1.25: Single slave (w/o a cs signal) mode bug fixes. Thx to DCM
V1.20: UI improvements
V1.15: CPOL=1 & CPHA=1 mode bug fixes
V1.10: Some little bug fixes
V1.01: Added description and release notes
V1.00: Initial release
</RELEASE_NOTES>
*/

/*
  TODO
  ================
    * Add hex view and packet view support
    * Better demo mode for Dual/Quad SPI
    * Update online documentation about dual/quad SPI (and also BuilderObject part)
    * Add progress reproting in demo signal builder
  Future evoluations
  ==================
    * Add support for DDR (https://en.wikipedia.org/wiki/Serial_Peripheral_Interface#Double_data_rate)
*/

//Decoder GUI
function on_draw_gui_decoder() {
    if (!check_api_version()) {
        ScanaStudio.gui_add_info_label("Warning! You need to update ScanaStudio to continue using this script.");
    }

    ScanaStudio.gui_add_ch_selector("ch_mosi", "MOSI (Master Out) Line", "MOSI");
    ScanaStudio.gui_add_ch_selector("ch_miso", "MISO (Slave Out) Line", "MISO");
    ScanaStudio.gui_add_ch_selector("ch_clk", "CLOCK Line", "SCLK");
    ScanaStudio.gui_add_ch_selector("ch_cs", "Chip Select (Slave select)", "CS");
    ScanaStudio.gui_add_combo_box("bit_order", "Bit Order");
    ScanaStudio.gui_add_item_to_combo_box("Most significant bit first (MSB)", true);
    ScanaStudio.gui_add_item_to_combo_box("Least significant bit first (LSB)");

    ScanaStudio.gui_add_new_tab("SPI Mode configuration", false);
    ScanaStudio.gui_add_combo_box("cpol", "Clock polarity");
    ScanaStudio.gui_add_item_to_combo_box("(CPOL = 0) clock LOW when inactive", true);
    ScanaStudio.gui_add_item_to_combo_box("(CPOL = 1) Clock HIGH when inactive");
    ScanaStudio.gui_add_combo_box("cpha", "Clock phase");
    ScanaStudio.gui_add_item_to_combo_box("(CPHA = 0) Data samples on leading edge", true);
    ScanaStudio.gui_add_item_to_combo_box("(CPHA = 1) Data samples on trailing edge");
    ScanaStudio.gui_end_tab();

    ScanaStudio.gui_add_new_tab("Output format", false);
    ScanaStudio.gui_add_check_box("format_hex", "HEX", true);
    ScanaStudio.gui_add_check_box("format_ascii", "ASCII", false);
    ScanaStudio.gui_add_check_box("format_dec", "Unsigned decimal", false);
    ScanaStudio.gui_add_check_box("format_bin", "Binary", false);
    ScanaStudio.gui_end_tab();

    ScanaStudio.gui_add_new_tab("Advanced options", false);
    ScanaStudio.gui_add_combo_box("nbits", "Bits per word");
    for (i = 2; i < 65; i++) {
        if (i == 8) {
            ScanaStudio.gui_add_item_to_combo_box(i.toString(10), true);
        }
        else {
            ScanaStudio.gui_add_item_to_combo_box(i.toString(10), false);
        }
    }

    ScanaStudio.gui_add_combo_box("cspol", "Chip Select");
    ScanaStudio.gui_add_item_to_combo_box("Active low", true);
    ScanaStudio.gui_add_item_to_combo_box("Active high");
    ScanaStudio.gui_add_combo_box("opt", "MOSI/MISO options");
    ScanaStudio.gui_add_item_to_combo_box("None", true);
    ScanaStudio.gui_add_item_to_combo_box("Ignore MOSI line");
    ScanaStudio.gui_add_item_to_combo_box("Ignore MISO line");
    ScanaStudio.gui_end_tab();

    ScanaStudio.gui_add_new_tab("Ignore Chip Select / Slave select", false);
    ScanaStudio.gui_add_info_label("If CS line is not available, the decoder\n"
        + "can use a timeout in the clock line instead to detect new packet.\n"
    );
    ScanaStudio.gui_add_check_box("ignore_cs", "Ignore CS and rely on timeout below", false);
    ScanaStudio.gui_add
    ScanaStudio.gui_add_engineering_form_input_box("clk_timeout" /* string */,
        "Max idle clock time (timeout)" /* string */,
        1e-6 /* float */,
        100 /* float */,
        5e-6 /* float */,
        "s" /* string */);
    ScanaStudio.gui_end_tab();

    if (ScanaStudio.get_device_channels_count() > 4) {
        ScanaStudio.gui_add_new_tab("Dual/Quad IO", false);
    }
    else {
        ScanaStudio.gui_add_new_tab("Dual IO", false);
    }

    ScanaStudio.gui_add_check_box("dual_io", "Decode Dual IO SPI", false);

    if (ScanaStudio.get_device_channels_count() > 4) {
        ScanaStudio.gui_add_check_box("quad_io", "Decode Quad IO SPI", false);
    }
    else {
        ScanaStudio.gui_add_hidden_field("quad_io", 0);
    }
    if (ScanaStudio.get_device_channels_count() > 4) {
        ScanaStudio.gui_add_ch_selector("ch_io2", "IO 2", "");
        ScanaStudio.gui_add_ch_selector("ch_io3", "IO 3", "");
    }
    else {
        ScanaStudio.gui_add_hidden_field("ch_io2", 0);
        ScanaStudio.gui_add_hidden_field("ch_io3", 0);
    }

    ScanaStudio.gui_add_info_label("For dual IO, IO0 is the MOSI line, IO1 is the MISO line.\n"
        + "Decoded DUAL IO words will appear on CLK line.\n"
        + "Decoded QUAD IO words will appear on CS line.\n"
        + "Regular MOSI/MISO words will still appear on MOSI/MISO channels."
    );
    ScanaStudio.gui_end_tab();
}

//Evaluate decoder GUI
function on_eval_gui_decoder() {

    var instance_name = "SPI [";

    spi_ch_list = [];
    spi_ch_list.push(ScanaStudio.gui_get_value("ch_mosi"));
    spi_ch_list.push(ScanaStudio.gui_get_value("ch_miso"));
    spi_ch_list.push(ScanaStudio.gui_get_value("ch_clk"));
    spi_ch_list.push(ScanaStudio.gui_get_value("ch_cs"));


    if (ScanaStudio.get_device_channels_count() > 4) {
        if ((ScanaStudio.gui_get_value("dual_io") == true) || (ScanaStudio.gui_get_value("quad_io") == true)) {
            spi_ch_list.push(ScanaStudio.gui_get_value("ch_io2"));
            spi_ch_list.push(ScanaStudio.gui_get_value("ch_io3"));
        }
    }

    ch_list = []; //Global
    var duplicates = false;
    var i;

    for (i = 0; i < spi_ch_list.length; i++) {
        if (ch_list[spi_ch_list[i]] == spi_ch_list[i]) {
            return "Error: One or more channels are duplicates.";
        }
        else {
            ch_list[spi_ch_list[i]] = spi_ch_list[i];
        }
        instance_name += (spi_ch_list[i] + 1).toString();
        if (i < (spi_ch_list.length - 1)) {
            instance_name += ",";
        }
    }

    instance_name += "]";

    ScanaStudio.set_script_instance_name(instance_name);

    return ""; //All good.
}


//Global variables
var sampling_rate;
var state_machine
var trs_cs, trs_mosi, trs_miso, trs_clk;
var trs_io2, trs_io3;
var cs_start_sample, cs_end_sample, next_cs_start_sample;
var data_mosi, data_miso;
var data_dual, data_quad; //decoded data word
var miso_bit, mosi_bit; //bit value
var io2_bit, io3_bit;
var clk_active_edge;
var word_start_sample, word_end_sample;
var word_start_sample_dual, word_end_sample_dual; //multi_io version
var word_start_sample_quad, word_end_sample_quad;
var bit_counter, bit_counter_dual, bit_counter_quad;
var clock_sample_points = [];
var frame_counter;
var drw;
var data_channels = [];
var quad_channels = [];
var word_start_sample;
var spi_simple, spi_dual, spi_quad;
var last_clk_edge;
var clk_timeout_samples;
// Gui variables
var ch_mosi, ch_miso, ch_clk, ch_cs, bit_order;
var format_hex, format_ascii, format_dec, format_bin;
var cpol, cpha, nbits, cspol, opt, ch_io2, ch_io3;
var ignore_cs, clk_timeout;

function on_decode_signals(resume) {
    var margin;
    if (!check_api_version()) {
        ScanaStudio.console_error_msg("You need to update ScanaStudio to continue using this script.");
        return;
    }
    if (!resume) //If resume == false, it's the first call to this function.
    {

        //initialization code
        state_machine = 0;
        frame_counter = 0;
        cs_start_sample = 0;
        cs_end_sample = 0;
        next_cs_start_sample = 0;
        sampling_rate = ScanaStudio.get_capture_sample_rate();
        // read GUI values using
        ch_mosi = ScanaStudio.gui_get_value("ch_mosi");
        ch_miso = ScanaStudio.gui_get_value("ch_miso");
        ch_clk = ScanaStudio.gui_get_value("ch_clk");
        ch_cs = ScanaStudio.gui_get_value("ch_cs");
        ch_io2 = ScanaStudio.gui_get_value("ch_io2");
        ch_io3 = ScanaStudio.gui_get_value("ch_io3");
        bit_order = ScanaStudio.gui_get_value("bit_order");
        format_hex = ScanaStudio.gui_get_value("format_hex");
        format_ascii = ScanaStudio.gui_get_value("format_ascii");
        format_dec = ScanaStudio.gui_get_value("format_dec");
        format_bin = ScanaStudio.gui_get_value("format_bin");
        cpol = ScanaStudio.gui_get_value("cpol");
        cpha = ScanaStudio.gui_get_value("cpha");
        nbits = ScanaStudio.gui_get_value("nbits") + 2;
        cspol = ScanaStudio.gui_get_value("cspol");
        opt = ScanaStudio.gui_get_value("opt");
        dual_io = ScanaStudio.gui_get_value("dual_io");
        quad_io = ScanaStudio.gui_get_value("quad_io");
        ignore_cs = ScanaStudio.gui_get_value("ignore_cs");
        clk_timeout = ScanaStudio.gui_get_value("clk_timeout");

        //set clock active edge
        if ((cpol == 0) && (cpha == 0)) clk_active_edge = 1;
        if ((cpol == 0) && (cpha == 1)) clk_active_edge = 0;
        if ((cpol == 1) && (cpha == 0)) clk_active_edge = 0;
        if ((cpol == 1) && (cpha == 1)) clk_active_edge = 1;

        //Reset transition iterators
        ScanaStudio.trs_reset(ch_cs);
        ScanaStudio.trs_reset(ch_mosi);
        ScanaStudio.trs_reset(ch_miso);
        ScanaStudio.trs_reset(ch_clk);
        if (quad_io) {
            ScanaStudio.trs_reset(ch_io2);
            ScanaStudio.trs_reset(ch_io3);
        }

        //define sample point drawing depending on clock polarity
        if (cpol) {
            drw = "D";
        }
        else {
            drw = "U";
        }

        //Here we select the data channels to be fed to the the sync_word getter.
        data_channels = [];
        if (opt != 1) {
            data_channels.push(ch_mosi);
        }
        if (opt != 2) {
            data_channels.push(ch_miso);
        }

        if (quad_io) {
            quad_channels.push(ch_mosi);
            quad_channels.push(ch_miso);
            quad_channels.push(ch_io2);
            quad_channels.push(ch_io3);
        }

        last_clk_edge = -1;
        clk_timeout_samples = sampling_rate * clk_timeout;
        // ScanaStudio.console_info_msg("clk_timeout_samples " + clk_timeout_samples /* string */);
        // ScanaStudio.console_info_msg("Ignore_cs = " + ignore_cs);
    }

    while (ScanaStudio.abort_is_requested() == false) {
        //Ensure there are still transitions to be fetched
        if (ignore_cs == false) {
            if (!ScanaStudio.trs_is_not_last(ch_cs)) break;
        }
        /*if (opt != 1)
        {
            if (!ScanaStudio.trs_is_not_last(ch_miso)) break;
        }
        if (opt != 2)
        {
            if (!ScanaStudio.trs_is_not_last(ch_mosi)) break;
        }*/
        if (!ScanaStudio.trs_is_not_last(ch_clk)) break;

        switch (state_machine) {
            case 0: //search for CS leading edge
                if (ignore_cs) {
                    //search for an idle spot on the CLK signal
                    trs_clk = ScanaStudio.trs_get_next(ch_clk);
                    trs_cs = trs_clk; //just to avoid "undefined" errors
                    if (last_clk_edge != -1) {
                        if ((trs_clk.sample_index - last_clk_edge) > clk_timeout_samples) {
                            // ScanaStudio.console_info_msg("cs1" /* string */, last_clk_edge /* int [default = -1] */);
                            // ScanaStudio.console_info_msg("cs2" /* string */, trs_clk.sample_index /* int [default = -1] */);
                            cs_end_sample = last_clk_edge + 1;
                            cs_start_sample = next_cs_start_sample;
                            next_cs_start_sample = trs_clk.sample_index - 1;
                            state_machine++;
                            // ScanaStudio.console_info_msg("cs_start_sample" /* string */, cs_start_sample /* int [default = -1] */);
                            // ScanaStudio.console_info_msg("cs_end_sample" /* string */, cs_end_sample /* int [default = -1] */);
                        }
                    }
                    last_clk_edge = trs_clk.sample_index;
                }
                else {
                    trs_cs = ScanaStudio.trs_get_next(ch_cs);
                    if ((trs_cs.value == cspol) && (trs_cs.sample_index > 0)) //leading edge found!
                    {
                        cs_start_sample = trs_cs.sample_index;
                        //goto next state
                        state_machine++;
                    }
                }
                break;
            case 1: //wait for end of CS transition
                if (ignore_cs == false)
                    trs_cs = ScanaStudio.trs_get_next(ch_cs);
                if ((trs_cs.value != cspol) || (ignore_cs == true)) //Lagging edge found!
                {
                    if (ignore_cs == false)
                        cs_end_sample = trs_cs.sample_index;
                    // ScanaStudio.console_info_msg("cs_start_sample=" + cs_start_sample);
                    // ScanaStudio.console_info_msg("cs_end_sample=" + cs_end_sample);

                    if (ignore_cs == false) {
                        if (!ScanaStudio.is_pre_decoding()) {
                            if (cs_start_sample == 0) {
                                //ScanaStudio.console_info_msg("CS warning");
                                ScanaStudio.dec_item_new(ch_cs, cs_start_sample, cs_end_sample);
                                ScanaStudio.dec_item_emphasize_warning(); //Display this item as a warning
                                ScanaStudio.dec_item_add_content("Warning: CS leading edge is missing!");
                                ScanaStudio.dec_item_add_content("Warning: CS!");
                                ScanaStudio.dec_item_add_content("!CS!");
                                ScanaStudio.dec_item_add_content("!");
                                ScanaStudio.dec_item_end();
                            }
                        }
                    }

                    word_start_sample = cs_start_sample;
                    while (ScanaStudio.abort_is_requested() == false) //Get all the words in that frame
                    {
                        spi_simple = ScanaStudio.sync_decode(ch_clk,
                            data_channels,
                            word_start_sample,
                            clk_active_edge,
                            !bit_order, //1 = MSB first
                            nbits,
                            false,
                            0,
                            cs_end_sample
                        );

                        if (spi_simple.valid_bits == 0) {
                            break;
                        }


                        margin = 0.5 * (spi_simple.end_sample - spi_simple.start_sample) / spi_simple.valid_bits;

                        if (spi_simple.valid_bits == nbits) {
                            for (var ch = 0; ch < ((opt == 0) ? 2 : 1); ch++) {
                                var r = ScanaStudio.dec_item_new(data_channels[ch], spi_simple.start_sample - margin, spi_simple.end_sample + margin);
                                if (r == 1) {
                                    add_spi_content_to_dec_item("", spi_simple.unsigned_words[ch]);
                                    for (b = 0; b < spi_simple.sampling_points.length; b++) {
                                        ScanaStudio.dec_item_add_sample_point(spi_simple.sampling_points[b] + word_start_sample, drw);
                                    }
                                    ScanaStudio.dec_item_end();
                                }
                            }
                        }
                        word_start_sample = spi_simple.end_sample + 1;
                    }

                    if (dual_io) {
                        word_start_sample = cs_start_sample;
                        while (ScanaStudio.abort_is_requested() == false) //Get all the words in that frame
                        {

                            spi_dual = ScanaStudio.sync_decode(ch_clk,
                                data_channels,
                                word_start_sample,
                                clk_active_edge,
                                !bit_order, //1 = MSB first
                                nbits,
                                true,
                                0,
                                cs_end_sample
                            );

                            if (spi_dual.valid_bits == 0) {
                                break;
                            }

                            margin = 0.5 * (spi_dual.end_sample - spi_dual.start_sample) / 4;
                            if (spi_dual.valid_bits == nbits) {
                                var r = ScanaStudio.dec_item_new(ch_clk, spi_dual.start_sample - margin, spi_dual.end_sample + margin);
                                if (r == 1) {
                                    add_spi_content_to_dec_item("DUAL IO: ", spi_dual.unsigned_words[0]);
                                    for (b = 0; b < spi_dual.sampling_points.length; b++) {
                                        //ScanaStudio.console_info_msg("sampling bits:" + b,spi_dual.sampling_points[b]+word_start_sample);
                                        ScanaStudio.dec_item_add_sample_point(spi_dual.sampling_points[b] + word_start_sample, drw);
                                    }
                                    ScanaStudio.dec_item_end();
                                }
                            }
                            word_start_sample = spi_dual.end_sample + 1;
                        }
                    }

                    if (quad_io) {
                        word_start_sample = cs_start_sample;
                        while (ScanaStudio.abort_is_requested() == false) //Get all the words in that frame
                        {

                            spi_quad = ScanaStudio.sync_decode(ch_clk, quad_channels,
                                word_start_sample,
                                clk_active_edge,
                                !bit_order, //1 = MSB first
                                nbits,
                                true,
                                0,
                                cs_end_sample
                            );

                            if (spi_quad.valid_bits == 0) {
                                break;
                            }

                            margin = 0.5 * (spi_quad.end_sample - spi_quad.start_sample) / 2;
                            if (spi_quad.valid_bits == nbits) {
                                var r = ScanaStudio.dec_item_new(ch_cs, spi_quad.start_sample - margin, spi_quad.end_sample + margin);
                                if (r == 1) {
                                    add_spi_content_to_dec_item("QUAD IO: ", spi_quad.unsigned_words[0]);
                                    for (b = 0; b < spi_quad.sampling_points.length; b++) {
                                        //ScanaStudio.console_info_msg("sampling bits:" + b,spi_quad.sampling_points[b]+word_start_sample);
                                        ScanaStudio.dec_item_add_sample_point(spi_quad.sampling_points[b] + word_start_sample, drw);
                                    }
                                    ScanaStudio.dec_item_end();
                                }
                            }
                            word_start_sample = spi_quad.end_sample + 1;
                        }
                    }

                    //Advance iterators for other channels (other than CS)
                    state_machine = 0;
                    frame_counter++;
                }
            default:
                state_machine = 0;
        }
    }
}

function add_spi_content_to_dec_item(header, value) {
    var content, b;
    if (ScanaStudio.is_pre_decoding()) {
        //in case tbis decoder is called by another decoder,
        //provide data in a way that can be easily interpreted
        //by the parent decoder.
        content = frame_counter.toString() + ":0x" + value.toString(16);
        ScanaStudio.dec_item_add_content(content);
    }
    else {
        content = header;
        if (format_hex) {
            content += "0x" + pad(value.toString(16), Math.ceil(nbits / 4));
        }
        if (format_ascii) {
            content += " '" + String.fromCharCode(value) + "'";
        }
        if (format_dec) {
            content += " (" + value.toString(10) + ")";
        }
        if (format_bin) {
            content += " " + to_binary_str(value, nbits);
        }
        ScanaStudio.dec_item_add_content(content);

        //Add a smaller version of the content field, without the header
        content = "";
        if ((format_hex) && (content == "")) {
            content += "0x" + pad(value.toString(16), Math.ceil(nbits / 4));
        }
        if ((format_ascii) && (content == "")) {
            content += " " + String.fromCharCode(value);
        }
        if ((format_dec) && (content == "")) {
            content += " " + value.toString(10);
        }
        if ((format_bin) && (content == "")) {
            content += pad(value.toString(2), nbits);
        }
        ScanaStudio.dec_item_add_content(content);
    }
}

/*  A helper function add leading "0"s to numbers
      Parameters
        * num_str: A string of the number to be be 0-padded
        * size: The total wanted size of the output string
*/
function pad(num_str, size) {
    while (num_str.length < size) num_str = "0" + num_str;
    return num_str;
}

/*  A helper function to convert a number to binary string
    formated in groups of 4 bits (nibles).
*/
function to_binary_str(value, size) {
    var i;
    var str = pad(value.toString(2), size);
    var ret = "";
    for (i = 0; i < str.length; i += 4) {
        ret += str.slice(i, (i + 4)) + " ";
    }
    ret += str.slice(i);
    return ret;
}

/*
  *******************
  SPI Trigger squence builder
  *******************
*/

//Trigger sequence GUI
function on_draw_gui_trigger() {

    ScanaStudio.gui_add_info_label("Currently SPI trigger only support standard MOSI/MISO signals, "
        + "Dual and Quad IO modes are not supported.");

    ScanaStudio.gui_add_new_selectable_containers_group("trig_alternative", "Select trigger alternative");
    ScanaStudio.gui_add_new_container("Trigger on a any word", false);
    ScanaStudio.gui_add_info_label("Trigger on any SPI word, regardless of its value.");
    ScanaStudio.gui_end_container();
    ScanaStudio.gui_add_new_container("Trigger on word value", false);
    ScanaStudio.gui_add_combo_box("trig_channel", "Channel");
    ScanaStudio.gui_add_item_to_combo_box("MOSI", true);
    ScanaStudio.gui_add_item_to_combo_box("MISO", false);
    ScanaStudio.gui_add_text_input("trig_byte", "Trigger word value", "0x0");
    ScanaStudio.gui_add_text_input("byte_pos", "Word position in the frame", "0")
    ScanaStudio.gui_add_info_label("All fields can accept decimal value (65), "
        + "hex value (0x41) or ASCII character ('A'). First word position in a frame is 0.\n"
        + "The exact position of the word must be known and specified."
    );
    ScanaStudio.gui_end_container();
    ScanaStudio.gui_end_selectable_containers_group();
}

//Evaluate trigger GUI
function on_eval_gui_trigger() {
    if (ScanaStudio.gui_get_value("byte_pos") > 32) {
        return "Byte position need to be smaller than 32";
    }
    if ((ScanaStudio.gui_get_value("trig_byte").search("'") >= 0)
        && (ScanaStudio.gui_get_value("trig_byte").length > 3)) {
        return "Invalid trigger word, please type only one character, e.g. 'A'";
    }
    if (ScanaStudio.gui_get_value("trig_byte").search("\"") >= 0) {
        return "Trigger word field contains invalid characters";
    }
    return "" //All good.
}

function on_build_trigger() {
    //ScanaStudio.console_info_msg("on_build_trigger");
    // read trigger GUI values
    var alt_any_byte = (ScanaStudio.gui_get_value("trig_alternative") == 0);
    var alt_specific_byte = (ScanaStudio.gui_get_value("trig_alternative") == 1);
    var trig_channel = ScanaStudio.gui_get_value("trig_channel");
    var trig_byte = ScanaStudio.gui_get_value("trig_byte");
    var byte_pos = ScanaStudio.gui_get_value("byte_pos");
    // read Decoder GUI values (global variables)
    ch_mosi = ScanaStudio.gui_get_value("ch_mosi");
    ch_miso = ScanaStudio.gui_get_value("ch_miso");
    ch_clk = ScanaStudio.gui_get_value("ch_clk");
    ch_cs = ScanaStudio.gui_get_value("ch_cs");
    bit_order = ScanaStudio.gui_get_value("bit_order");
    format_hex = ScanaStudio.gui_get_value("format_hex");
    format_ascii = ScanaStudio.gui_get_value("format_ascii");
    format_dec = ScanaStudio.gui_get_value("format_dec");
    format_bin = ScanaStudio.gui_get_value("format_bin");
    cpol = ScanaStudio.gui_get_value("cpol");
    cpha = ScanaStudio.gui_get_value("cpha");
    nbits = ScanaStudio.gui_get_value("nbits") + 2;
    cspol = ScanaStudio.gui_get_value("cspol");
    opt = ScanaStudio.gui_get_value("opt");

    var i, k;
    var spi_step = { mosi: "X", miso: "X", clk: "X", cs: "X" };
    var spi_trig_steps = [];

    spi_trig_steps.length = 0;

    if (alt_any_byte) {
        summary_text = "Trig on any SPI byte"
    }
    else if (alt_specific_byte) {
        if (trig_byte.charAt(0) == "'") {
            trig_byte = trig_byte.charCodeAt(1);
        }
        else {
            trig_byte = Number(trig_byte);
        }
        summary_text = "Trig on SPI byte: 0x" + trig_byte.toString(16);
    }

    if (cspol == 0)			// cspol: 0 - cs active low, 1 - cs active high
    {
        spi_step.cs = "F";  //falling edge
    }
    else {
        spi_step.cs = "R"; //Rising edge
    }

    spi_trig_steps.push(new SpiTrigStep(spi_step.mosi, spi_step.miso, spi_step.clk, spi_step.cs));

    if (cspol == 0)			// cspol: 0 - cs active low, 1 - cs active high
    {
        spi_step.cs = "0"; //low level
    }
    else {
        spi_step.cs = "1"; //High level
    }

    spi_step.mosi = "X";
    spi_step.miso = "X";

    if (cpol == 0)				// cpol: 0 -  clk inactive low, 1 - clk inactive high
    {
        if (cpha == 0)			// cpha: 0 - data samples on leading edge, 1 - data samples on trailing edge
        {
            spi_step.clk = "R";
        }
        else {
            //Create a push initial step
            spi_step.clk = "R";
            spi_trig_steps.push(new SpiTrigStep(spi_step.mosi, spi_step.miso, spi_step.clk, spi_step.cs));
            spi_step.clk = "F";
        }
    }
    else {                  //cpol == 1 = inactive high
        if (cpha == 0) {
            spi_step.clk = "F";
        }
        else {
            //Create a push initial step
            spi_step.clk = "F";
            spi_trig_steps.push(new SpiTrigStep(spi_step.mosi, spi_step.miso, spi_step.clk, spi_step.cs));
            spi_step.clk = "R";
        }
    }

    //ScanaStudio.console_info_msg("alt_any_byte=" + alt_any_byte);
    //ScanaStudio.console_info_msg("alt_specific_byte=" + alt_specific_byte);
    //ScanaStudio.console_warning_msg("trig_channel=" + trig_channel);
    if (alt_any_byte) {        
        for (k = 0; k <= (byte_pos); k++) {
            for (i = 0; i < nbits; i++)	// nbits: 1 - 128 bits in data byte
            {
                //ScanaStudio.console_info_msg("pusing a new trig step");
                spi_trig_steps.push(new SpiTrigStep(spi_step.mosi, spi_step.miso, spi_step.clk, spi_step.cs));
            }
        }
    }
    else if (alt_specific_byte) {
        for (k = 0; k <= (byte_pos); k++) {
            if (bit_order == 0)							// bit_order: 0 - first bit is MSB, 1 - first bit is LSB
            {
                for (i = nbits - 1; i >= 0; i--) {
                    spi_step.mosi = "X";
                    spi_step.miso = "X";
                    if (k == byte_pos) {
                        if (trig_channel == 0)	// trig_channel: 0 - MOSI, 1 - MISO
                        {
                            spi_step.mosi = ((trig_byte >> i) & 0x1).toString();
                        }
                        else {
                            spi_step.miso = ((trig_byte >> i) & 0x1).toString();
                        }
                    }
                    spi_trig_steps.push(new SpiTrigStep(spi_step.mosi, spi_step.miso, spi_step.clk, spi_step.cs));
                }
            }
            else {
                for (i = 0; i < nbits; i++) {
                    spi_step.mosi = "X";
                    spi_step.miso = "X";
                    if (k == byte_pos) {
                        if (trig_channel == 0)	// trig_channel: 0 - MOSI, 1 - MISO
                        {
                            spi_step.mosi = ((trig_byte >> i) & 0x1).toString();
                        }
                        else {
                            spi_step.miso = ((trig_byte >> i) & 0x1).toString();
                        }
                    }
                    spi_trig_steps.push(new SpiTrigStep(spi_step.mosi, spi_step.miso, spi_step.clk, spi_step.cs));
                }
            }
        }
    }

    //ScanaStudio.console_info_msg("spi_trig_steps.length = " + spi_trig_steps.length);

    for (i = 0; i < spi_trig_steps.length; i++) {
        ScanaStudio.flexitrig_append(trig_build_step(spi_trig_steps[i]), -1, -1);
    }

    //ScanaStudio.flexitrig_print_steps();

    // flexitrig_print_steps();
}

function SpiTrigStep(mosi, miso, clk, cs) {
    this.mosi = mosi;
    this.miso = miso;
    this.clk = clk;
    this.cs = cs;
};

function trig_build_step(step_desc) {
    var i;
    var step = "";

    for (i = 0; i < ScanaStudio.get_device_channels_count(); i++) {
        switch (i) {
            case ch_mosi: step = step_desc.mosi + step; break;
            case ch_miso: step = step_desc.miso + step; break;
            case ch_clk: step = step_desc.clk + step; break;
            case ch_cs: step = step_desc.cs + step; break;
            default: step = "X" + step; break;
        }
    }

    return step;
}

//Function called to generate demo siganls (when no physical device is attached)
function on_build_demo_signals() {
    //Use the function below to get the number of samples to be built
    var samples_to_build = ScanaStudio.builder_get_maximum_samples_count();
    var silence_period = (samples_to_build / (125 * ScanaStudio.builder_get_sample_rate()));
    var spi_builder = ScanaStudio.BuilderObject;
    var ch_clk = ScanaStudio.gui_get_value("ch_clk");
    var nbits = ScanaStudio.gui_get_value("nbits");
    var quad_io = ScanaStudio.gui_get_value("quad_io");
    var dual_io = ScanaStudio.gui_get_value("dual_io");
    spi_builder.config(
        ScanaStudio.gui_get_value("ch_mosi"),
        ScanaStudio.gui_get_value("ch_miso"),
        ScanaStudio.gui_get_value("ch_clk"),
        ScanaStudio.gui_get_value("ch_cs"),
        ScanaStudio.gui_get_value("bit_order"),
        ScanaStudio.gui_get_value("cpol"),
        ScanaStudio.gui_get_value("cpha"),
        ScanaStudio.gui_get_value("nbits"),
        ScanaStudio.gui_get_value("cspol"),
        ScanaStudio.builder_get_sample_rate(),
        ScanaStudio.builder_get_sample_rate() / 100  //clock frequency
    );
    spi_builder.config_multi_io(
        ScanaStudio.gui_get_value("ch_mosi"),
        ScanaStudio.gui_get_value("ch_miso"),
        ScanaStudio.gui_get_value("ch_io2"),
        ScanaStudio.gui_get_value("ch_io3"),
        ScanaStudio.gui_get_value("quad_io")
    );

    var random_mosi, random_miso, random_size, w;
    spi_builder.put_silence(10e-6);

    //Test dual/quad IO
    if (dual_io) {
        spi_builder.put_start();
        spi_builder.put_word(0xBB, 0);  //Fast read dual IO
        spi_builder.put_word_dual(0x33);  //Address
        spi_builder.put_word_dual(0x22);
        spi_builder.put_word_dual(0x11);
        spi_builder.put_word_dual(0xDD); //Dumy word
        spi_builder.put_word_dual(0x01); //Test data
        spi_builder.put_word_dual(0x02);
        spi_builder.put_word_dual(0x03);
        spi_builder.put_word_dual(0x04);
        spi_builder.put_word_dual(0x05);
        spi_builder.put_word_dual(0x06);
        spi_builder.put_silence(1e-6);
        spi_builder.put_stop();
        spi_builder.put_silence(1e-6);
    }

    if (quad_io) {
        spi_builder.put_start();
        spi_builder.put_word(0xEB, 0); //Fast read, quad io
        spi_builder.put_word_quad(0xFF);  //Address
        spi_builder.put_word_quad(0x22);
        spi_builder.put_word_quad(0x11);
        spi_builder.put_word_quad(0xFF); //Dumy word
        spi_builder.put_word_quad(0xF1); //Dumy word
        spi_builder.put_word_quad(0xF2); //Dumy word
        spi_builder.put_word_quad(0x01); //Test data
        spi_builder.put_word_quad(0x02);
        spi_builder.put_word_quad(0x03);
        spi_builder.put_word_quad(0x04);
        spi_builder.put_word_quad(0x05);
        spi_builder.put_word_quad(0x06);
        spi_builder.put_word_quad(0x07);
        spi_builder.put_word_quad(0x08);
        spi_builder.put_silence(1e-6);
        spi_builder.put_stop();
        spi_builder.put_silence(1e-6);
    }



    while (ScanaStudio.builder_get_samples_acc(ch_clk) < samples_to_build) {
        random_size = Math.floor(Math.random() * 10) + 1;
        spi_builder.put_start();
        spi_builder.put_silence(1e-6); //1 us
        for (w = 0; w < random_size; w++) {
            random_mosi = Math.floor(Math.random() * (Math.pow(2, nbits)));
            random_miso = Math.floor(Math.random() * (Math.pow(2, nbits)));
            spi_builder.put_word(random_mosi, random_miso);
            spi_builder.put_silence(1e-6); //1 us
        }

        spi_builder.put_stop();
        spi_builder.put_silence(silence_period);

        if (ScanaStudio.abort_is_requested()) {
            break;
        }
    }
}

//Builder object that can be shared to other scripts
ScanaStudio.BuilderObject = {
    //to be configured by the user of this object using the setter functions below
    sampling_rate: 1e6,
    put_start: function (parameter) {
        this.last_cs = this.cspol;
        this.put_silence(0);
    },
    put_stop: function (parameter) {
        this.last_cs = (~this.cspol & 0x1);
        this.put_silence(0);
    },
    put_silence: function (duration_s) {
        var samples_count = duration_s * this.sample_rate;
        if (samples_count == 0) samples_count = 1;
        //ScanaStudio.console_info_msg("this.last_cs=" + this.last_cs);
        //ScanaStudio.console_info_msg("samples_count=" + samples_count);
        ScanaStudio.builder_add_samples(this.ch_miso, this.last_miso, samples_count);
        ScanaStudio.builder_add_samples(this.ch_mosi, this.last_mosi, samples_count);
        ScanaStudio.builder_add_samples(this.ch_clk, this.last_clk, samples_count);
        ScanaStudio.builder_add_samples(this.ch_cs, this.last_cs, samples_count);
        if (this.quad_io) {
            ScanaStudio.builder_add_samples(this.ch_io2, this.last_io2, samples_count);
            ScanaStudio.builder_add_samples(this.ch_io3, this.last_io3, samples_count);
        }
    },
    put_word: function (w_mosi, w_miso) {
        var i;
        var b_mosi, b_miso;
        for (i = 0; i < this.nbits; i++) {
            if (this.bit_order == 0) {
                b_mosi = ((w_mosi >> (this.nbits - i - 1)) & 0x1);
                b_miso = ((w_miso >> (this.nbits - i - 1)) & 0x1);
            }
            else {
                b_mosi = ((w_mosi >> i) & 0x1);
                b_miso = ((w_miso >> i) & 0x1);
            }
            this.put_bit(b_mosi, b_miso);
        }
    },
    put_word_dual: function (w) {
        var i;
        var b_io0, b_io1;
        for (i = 0; i < this.nbits; i += 2) {
            if (this.bit_order == 0) {
                b_io0 = ((w >> (this.nbits - i - 2)) & 0x1);
                b_io1 = ((w >> (this.nbits - i - 1)) & 0x1);
            }
            else {
                b_io0 = ((w >> i) & 0x1);
                b_io1 = ((w >> (i + 1)) & 0x1);
            }
            this.put_bit_dual(b_io0, b_io1);
        }
    },
    put_word_quad: function (w) {
        var i;
        var b_io0, b_io1, b_io2, b_io3;
        for (i = 0; i < this.nbits; i += 4) {
            if (this.bit_order == 0) {
                b_io0 = ((w >> (this.nbits - i - 4)) & 0x1);
                b_io1 = ((w >> (this.nbits - i - 3)) & 0x1);
                b_io2 = ((w >> (this.nbits - i - 2)) & 0x1);
                b_io3 = ((w >> (this.nbits - i - 1)) & 0x1);
            }
            else {
                b_io0 = ((w >> i) & 0x1);
                b_io1 = ((w >> (i + 1)) & 0x1);
                b_io2 = ((w >> (i + 2)) & 0x1);
                b_io3 = ((w >> (i + 3)) & 0x1);
            }
            this.put_bit_quad(b_io0, b_io1, b_io2, b_io3);
        }
    },
    put_bit: function (b_mosi, b_miso) {
        if (this.cpha == 0) {
            this.put_half_bit(b_mosi, b_miso, this.cpol & 0x1, this.cspol);
            this.put_half_bit(b_mosi, b_miso, ~this.cpol & 0x1, this.cspol);
        }
        else {
            this.put_half_bit(b_mosi, b_miso, ~this.cpol & 0x1, this.cspol);
            this.put_half_bit(b_mosi, b_miso, this.cpol & 0x1, this.cspol);
        }
        this.last_clk = this.cpol;  //reset clock idle state
    },
    put_bit_dual: function (b_io0, b_io1) {
        if (this.cpha == 0) {
            this.put_half_bit_dual(b_io0, b_io1, this.cpol & 0x1, this.cspol);
            this.put_half_bit_dual(b_io0, b_io1, ~this.cpol & 0x1, this.cspol);
        }
        else {
            this.put_half_bit_dual(b_io0, b_io1, ~this.cpol & 0x1, this.cspol);
            this.put_half_bit_dual(b_io0, b_io1, this.cpol & 0x1, this.cspol);
        }
        this.last_clk = this.cpol;  //reset clock idle state
    },
    put_bit_quad: function (b_io0, b_io1, b_io2, b_io3) {
        if (this.cpha == 0) {
            this.put_half_bit_quad(b_io0, b_io1, b_io2, b_io3, this.cpol & 0x1, this.cspol);
            this.put_half_bit_quad(b_io0, b_io1, b_io2, b_io3, ~this.cpol & 0x1, this.cspol);
        }
        else {
            this.put_half_bit_quad(b_io0, b_io1, b_io2, b_io3, ~this.cpol & 0x1, this.cspol);
            this.put_half_bit_quad(b_io0, b_io1, b_io2, b_io3, this.cpol & 0x1, this.cspol);
        }
        this.last_clk = this.cpol;  //reset clock idle state
    },
    put_half_bit: function (b_mosi, b_miso, clk, cs) {
        ScanaStudio.builder_add_samples(this.ch_mosi, b_mosi, this.samples_per_half_clock);
        ScanaStudio.builder_add_samples(this.ch_miso, b_miso, this.samples_per_half_clock);
        ScanaStudio.builder_add_samples(this.ch_clk, clk, this.samples_per_half_clock);
        ScanaStudio.builder_add_samples(this.ch_cs, cs, this.samples_per_half_clock);
        if (this.quad_io) {
            ScanaStudio.builder_add_samples(this.ch_io2, this.last_io2, this.samples_per_half_clock);
            ScanaStudio.builder_add_samples(this.ch_io3, this.last_io3, this.samples_per_half_clock);
        }
        this.last_cs = cs;
        this.last_clk = clk;
        this.last_mosi = b_mosi;
        this.last_miso = b_miso;
    },
    put_half_bit_dual: function (b_io0, b_io1, clk, cs) {
        ScanaStudio.builder_add_samples(this.ch_io0, b_io0, this.samples_per_half_clock);
        ScanaStudio.builder_add_samples(this.ch_io1, b_io1, this.samples_per_half_clock);
        ScanaStudio.builder_add_samples(this.ch_clk, clk, this.samples_per_half_clock);
        ScanaStudio.builder_add_samples(this.ch_cs, cs, this.samples_per_half_clock);
        if (this.quad_io) {
            ScanaStudio.builder_add_samples(this.ch_io2, this.last_io2, this.samples_per_half_clock);
            ScanaStudio.builder_add_samples(this.ch_io3, this.last_io3, this.samples_per_half_clock);
        }
        this.last_cs = cs;
        this.last_clk = clk;
        this.last_io0 = b_io0;
        this.last_io1 = b_io1;
    },
    put_half_bit_quad: function (b_io0, b_io1, b_io2, b_io3, clk, cs) {
        ScanaStudio.builder_add_samples(this.ch_io0, b_io0, this.samples_per_half_clock);
        ScanaStudio.builder_add_samples(this.ch_io1, b_io1, this.samples_per_half_clock);
        ScanaStudio.builder_add_samples(this.ch_io2, b_io2, this.samples_per_half_clock);
        ScanaStudio.builder_add_samples(this.ch_io3, b_io3, this.samples_per_half_clock);
        ScanaStudio.builder_add_samples(this.ch_clk, clk, this.samples_per_half_clock);
        ScanaStudio.builder_add_samples(this.ch_cs, cs, this.samples_per_half_clock);
        this.last_cs = cs;
        this.last_clk = clk;
        this.last_io0 = b_io0;
        this.last_io1 = b_io1;
        this.last_io1 = b_io1;
        this.last_io2 = b_io2;
    },
    config: function (ch_mosi, ch_miso, ch_clk, ch_cs, bit_order, cpol, cpha, nbits, cspol, sample_rate, clk_frequency) {
        this.ch_mosi = ch_mosi;
        this.ch_miso = ch_miso;
        this.ch_clk = ch_clk;
        this.ch_cs = ch_cs;
        this.bit_order = bit_order;
        this.cpol = cpol;
        this.cpha = cpha;
        this.nbits = nbits + 2;
        this.cspol = cspol;
        this.sample_rate = sample_rate;
        this.samples_per_half_clock = (sample_rate / clk_frequency);
        //Set idle states
        this.last_mosi = 0;
        this.last_miso = 0;
        this.last_clk = (cpol & 0x1);
        this.last_cs = (~this.cspol & 0x1);
        //ScanaStudio.console_info_msg("this.last_cs=" + this.last_cs);
    },
    config_multi_io: function (ch_io0, ch_io1, ch_io2, ch_io3, quad_io) {
        this.ch_io0 = ch_io0;
        this.ch_io1 = ch_io1;
        this.ch_io2 = ch_io2;
        this.ch_io3 = ch_io3;
        this.quad_io = quad_io;
    }
};


function version_str_to_int(version) {
    v = version.split(".");
    if (v.length < 3) {
        ScanaStudio.console_error_msg("Invalid version: " + version);
        return 0;
    }
    else {
        return (v[0] * 10000) + (v[1] * 100) + v[2];
    }
}

function check_api_version() {
    var required_str = "3.1.0";
    if (version_str_to_int(required_str) > version_str_to_int(
        ScanaStudio.get_api_version())) {
        return false; //API too old, update needed
    }
    else {
        return true;
    }
}
