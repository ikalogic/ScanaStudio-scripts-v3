/* Protocol meta info:
<NAME> RGB LED </NAME>
<DESCRIPTION>
Adressable RGB LED chipsets
</DESCRIPTION>
<VERSION> 0.2 </VERSION>
<AUTHOR_NAME>  Vladislav Kosinov </AUTHOR_NAME>
<AUTHOR_URL> v.kosinov@ikalogic.com </AUTHOR_URL>
<HELP_URL> https://github.com/ikalogic/ScanaStudio-scripts-v3/wiki </HELP_URL>
<COPYRIGHT> Copyright 2019 Ikalogic SAS </COPYRIGHT>
<LICENSE> This code is distributed under the terms of the GNU General Public License GPLv3 </LICENSE>
<RELEASE_NOTES>
V0.2: Added dec_item_end() for each dec_item_new().
V0.1: Initial release.
</RELEASE_NOTES>
*/

var CHIPSETS_TABLE =
{
    WS2811   : {chip_id: 0, rst_time: (50 * 1e-6),  bit_time: 0,             bit_var: 0,            t0h: (250 * 1e-9), t0l: (1.0 * 1e-6),  t1h: (600 * 1e-9),  t1l: (650 * 1e-9), t_var: (150 * 1e-9), clr_order: "GRB", str: "WS2811"},
    WS2812   : {chip_id: 1, rst_time: (50 * 1e-6),  bit_time: (1.25 * 1e-6), bit_var: (600 * 1e-9), t0h: (350 * 1e-9), t0l: (800 * 1e-9),  t1h: (700 * 1e-9),  t1l: (600 * 1e-9), t_var: (150 * 1e-9), clr_order: "GRB", str: "WS2812"},
    WS2812B  : {chip_id: 2, rst_time: (50 * 1e-6),  bit_time: (1.25 * 1e-6), bit_var: (600 * 1e-9), t0h: (400 * 1e-9), t0l: (850 * 1e-9),  t1h: (800 * 1e-9),  t1l: (450 * 1e-9), t_var: (150 * 1e-9), clr_order: "GRB", str: "WS2812B"},
    WS2812V4 : {chip_id: 3, rst_time: (280 * 1e-6), bit_time: 0,             bit_var: 0,            t0h: (300 * 1e-9), t0l: (790 * 1e-9),  t1h: (790 * 1e-9),  t1l: (320 * 1e-9), t_var: (210 * 1e-9), clr_order: "GRB", str: "WS2812-V4"},
    WS2813   : {chip_id: 4, rst_time: (300 * 1e-6), bit_time: (1.25 * 1e-6), bit_var: (300 * 1e-9), t0h: (375 * 1e-9), t0l: (300 * 1e-9),  t1h: (875 * 1e-9),  t1l: (300 * 1e-9), t_var: (150 * 1e-9), clr_order: "GRB", str: "WS2813"},
    WS2815   : {chip_id: 5, rst_time: (280 * 1e-6), bit_time: 0,             bit_var: 0,            t0h: (300 * 1e-9), t0l: (1.09 * 1e-6), t1h: (1.09 * 1e-6), t1l: (320 * 1e-9), t_var: (510 * 1e-9), clr_order: "GRB", str: "WS2815"},
    APA104   : {chip_id: 6, rst_time: (24 * 1e-6),  bit_time: (1.25 * 1e-6), bit_var: (600 * 1e-9), t0h: (350 * 1e-9), t0l: (1.36 * 1e-6), t1h: (1.36 * 1e-6), t1l: (350 * 1e-9), t_var: (150 * 1e-9), clr_order: "RGB", str: "APA104"},
    SK6805   : {chip_id: 7, rst_time: (24 * 1e-6),  bit_time: (1.25 * 1e-6), bit_var: (600 * 1e-9), t0h: (300 * 1e-9), t0l: (900 * 1e-9),  t1h: (900 * 1e-9),  t1l: (300 * 1e-9), t_var: (150 * 1e-9), clr_order: "RGB", str: "SK6805"},
    SK6812   : {chip_id: 8, rst_time: (80 * 1e-6),  bit_time: (1.25 * 1e-6), bit_var: (600 * 1e-9), t0h: (300 * 1e-9), t0l: (900 * 1e-9),  t1h: (600 * 1e-9),  t1l: (600 * 1e-9), t_var: (150 * 1e-9), clr_order: "GRB", str: "SK6812"},
    CUSTOM   : {chip_id: 9, rst_time: (80 * 1e-6),  bit_time: (1.25 * 1e-6), bit_var: (600 * 1e-9), t0h: (300 * 1e-9), t0l: (900 * 1e-9),  t1h: (600 * 1e-9),  t1l: (600 * 1e-9), t_var: (150 * 1e-9), clr_order: "GRB", str: "CUSTOM"}
}

function BitObject (st_sample, end_sample, value)
{
    this.st_sample = st_sample;
	this.end_sample = end_sample;
    this.value = value;
};

//Global variables
var ch = 0;
var sample_rate = 0;
var state_machine = 0;
var chip = null;
var trs = null, trs_last = null;
var bit_time = 0;
var t0h = false, t1h = false;
var bitstream_arr = [];
var bit_object = null;
var bit_cnt = 0, word_cnt = 0;

function get_current_chip()
{
    var user_chip_id = Number(ScanaStudio.gui_get_value("chip_id"));
    var chip = null;

    for (var i in CHIPSETS_TABLE)
    {
        if (CHIPSETS_TABLE[i].chip_id == user_chip_id)
        {
            chip = CHIPSETS_TABLE[i];
        }
    }

    return chip;
}

//Decoder GUI
function on_draw_gui_decoder()
{
    //Define decoder configuration GUI
    ScanaStudio.gui_add_ch_selector("ch", "Select channel to decode", "RGB");
    ScanaStudio.gui_add_new_selectable_containers_group("chip_id", "Chipset")

    for (var i in CHIPSETS_TABLE)
    {
        var c = CHIPSETS_TABLE[i];

        if (i == 0)
        {
            ScanaStudio.gui_add_new_container(c.str, true);
        }
        else
        {
            ScanaStudio.gui_add_new_container(c.str, false);
        }

        ScanaStudio.gui_add_engineering_form_input_box(c.str + "_rst_time", "Reset time", (c.rst_time / 10), (c.rst_time * 10), c.rst_time, "s");

        if (c.bit_time > 0)
        {
            ScanaStudio.gui_add_engineering_form_input_box(c.str + "_bit_time", "Bit time", (c.bit_time / 10), (c.bit_time * 10), c.bit_time, "s");

            if (c.bit_var > 0)
            {
                ScanaStudio.gui_add_engineering_form_input_box(c.str + "_bit_var", "Bit time variation (+/-)", (c.bit_var / 10), (c.bit_var * 10), c.bit_var, "s");
            }
        }

        ScanaStudio.gui_add_engineering_form_input_box(c.str + "_t0h", "T0H", (c.t0h / 10), (c.t0h * 10), c.t0h, "s");
        ScanaStudio.gui_add_engineering_form_input_box(c.str + "_t0l", "T0L", (c.t0l / 10), (c.t0l * 10), c.t0l, "s");
        ScanaStudio.gui_add_engineering_form_input_box(c.str + "_t1h", "T1H", (c.t1h / 10), (c.t1h * 10), c.t1h, "s");
        ScanaStudio.gui_add_engineering_form_input_box(c.str + "_t1l", "T1L", (c.t1l / 10), (c.t1l * 10), c.t1l, "s");

        if (c.t_var > 0)
        {
            ScanaStudio.gui_add_engineering_form_input_box(c.str + "_t_var", "TnX time variation (+/-)", (c.t_var / 10), (c.t_var * 10), c.t_var, "s");
        }

        ScanaStudio.gui_add_combo_box(c.str + "_clr_order", "Color order");

        if (c.clr_order == "RGB")
        {
            ScanaStudio.gui_add_item_to_combo_box("RGB", true);
            ScanaStudio.gui_add_item_to_combo_box("GRB", false);
        }
        else
        {
            ScanaStudio.gui_add_item_to_combo_box("RGB", false);
            ScanaStudio.gui_add_item_to_combo_box("GRB", true);
        }

        ScanaStudio.gui_end_container();
    }

    ScanaStudio.gui_end_selectable_containers_group();
}

//Evaluate decoder GUI
function on_eval_gui_decoder()
{
    var user_chip_id = Number(ScanaStudio.gui_get_value("chip_id"));
    chip = get_current_chip();

    chip.rst_time = Number(ScanaStudio.gui_get_value(chip.str + "_rst_time"));

    if (chip.bit_time > 0)
    {
        chip.bit_time = Number(ScanaStudio.gui_get_value(chip.str + "_bit_time"));
    }

    if (chip.bit_var > 0)
    {
        chip.bit_var = Number(ScanaStudio.gui_get_value(chip.str + "_bit_var"));
    }

    chip.t0h = Number(ScanaStudio.gui_get_value(chip.str + "_t0h"));
    chip.t0l = Number(ScanaStudio.gui_get_value(chip.str + "_t0l"));
    chip.t1h = Number(ScanaStudio.gui_get_value(chip.str + "_t1h"));
    chip.t1l = Number(ScanaStudio.gui_get_value(chip.str + "_t1l"));

    if (chip.t_var > 0)
    {
        chip.t_var = Number(ScanaStudio.gui_get_value(chip.str + "_t_var"));
    }

    if (chip.bit_time > 0)
    {
        var bit_time_max = chip.bit_time;
        var bit_time_min = chip.bit_time;

        if (chip.bit_var > 0)
        {
            bit_time_max += chip.bit_var;
            bit_time_min -= chip.bit_var;
        }

        if ((chip.t0h + chip.t0l) > bit_time_max)
        {
            return "'T0H' + 'T0L' cannot be superior than 'Bit time' + 'Bit time variation'";
        }

        if ((chip.t0h + chip.t0l) < bit_time_min)
        {
            return "'T0H' + 'T0L' cannot be inferior than 'Bit time' - 'Bit time variation'";
        }

        if ((chip.t1h + chip.t1l) > bit_time_max)
        {
            return "'T1H' + 'T1L' cannot be superior than 'Bit time' + 'Bit time variation'";
        }

        if ((chip.t1h + chip.t1l) < bit_time_min)
        {
            return "'T1H' + 'T1L' cannot be inferior than 'Bit time' - 'Bit time variation'";
        }
    }

    chip.clr_order = Number(ScanaStudio.gui_get_value(chip.str + "_clr_order"));

    return "";
}

function on_decode_signals (resume)
{
    var bit_time_max, bit_time_min;

    if (!resume)
    {
        state_machine = 0;
        sample_rate = ScanaStudio.get_capture_sample_rate();
        ch = Number(ScanaStudio.gui_get_value("ch"));
        chip = get_current_chip();
        bit_object = new BitObject(0, 0, 0);

        ScanaStudio.trs_reset(ch);
        trs = ScanaStudio.trs_get_next(ch);
    }

    while (ScanaStudio.trs_is_not_last(ch))
    {
        if (ScanaStudio.abort_is_requested())
        {
            return;
        }

        if (chip.bit_time > 0)
        {
            bit_time_max = chip.bit_time;
            bit_time_min = chip.bit_time;
        }

        if (chip.bit_var > 0)
        {
            bit_time_max += chip.bit_var;
            bit_time_min -= chip.bit_var;
        }

        trs_last = trs;
        trs = ScanaStudio.trs_get_next(ch);
        var t = (trs.sample_index - trs_last.sample_index) / sample_rate;

        if (trs_last.value > 0)
        {
            if ((t >= (chip.t0h - chip.t_var)) && (t <= (chip.t0h + chip.t_var)))
            {
                t0h = true;
                t1h = false;
                bit_object = new BitObject(trs_last.sample_index, 0, 0);
            }
            else if ((t >= (chip.t1h - chip.t_var)) && (t <= (chip.t1h + chip.t_var)))
            {
                t1h = true;
                t0h = false;
                bit_object = new BitObject(trs_last.sample_index, 0, 0);
            }
            else
            {
                t0h = false;
                t1h = false;

                ScanaStudio.dec_item_new(ch, trs_last.sample_index, trs.sample_index);
                ScanaStudio.dec_item_add_content("WRONG T1H/T0H DURATION");
                ScanaStudio.dec_item_add_content("WRONG");
                ScanaStudio.dec_item_add_content("!");
                ScanaStudio.dec_item_emphasize_error();
                ScanaStudio.dec_item_end();
            }
        }
        else
        {
            if (t >= chip.rst_time)
            {
                if (t0h || t1h)
                {
                    if (t0h)
                    {
                        bit_object.value = 0;
                        bit_object.end_sample = (trs_last.sample_index + (chip.t0h * sample_rate));
                    }
                    else
                    {
                        bit_object.value = 1;
                        bit_object.end_sample = (trs_last.sample_index + (chip.t1h * sample_rate));
                    }

                    bit_cnt++;
                    decode_word(bit_object);

                    t0h = false;
                    t1h = false;
                }

                word_cnt = 0;

                ScanaStudio.dec_item_new(ch, (trs_last.sample_index + (chip.t1h * sample_rate)), trs.sample_index);
                ScanaStudio.dec_item_add_content("RESET");
                ScanaStudio.dec_item_add_content("RST");
                ScanaStudio.dec_item_add_content("R");
                ScanaStudio.dec_item_end();

                ScanaStudio.packet_view_add_packet(true, ch, -1,  -1, "RGB LED", chip.str, ScanaStudio.get_channel_color(ch), ScanaStudio.get_channel_color(ch));
                ScanaStudio.packet_view_add_packet(false, ch, (trs_last.sample_index + (chip.t1h * sample_rate)),  trs.sample_index, "LED", "RESET", "#D3D3D3", "#D3D3D3");
            }
            else if ((t >= (chip.t0l - chip.t_var)) && (t <= (chip.t0l + chip.t_var)))
            {
                if (t0h)
                {
                    bit_object.end_sample = trs.sample_index;
                    bit_object.value = 0;
                    t0h = false;
                    bit_cnt++;

                    if (chip.bit_time > 0)
                    {
                        if ((bit_object.end_sample - bit_object.st_sample) > (bit_time_max * sample_rate))
                        {
                            ScanaStudio.dec_item_new(ch, bit_object.st_sample, bit_object.end_sample);
                            ScanaStudio.dec_item_emphasize_warning();
                            ScanaStudio.dec_item_end();
                        }
                        else if ((bit_object.end_sample - bit_object.st_sample) < (bit_time_min * sample_rate))
                        {
                            ScanaStudio.dec_item_new(ch, bit_object.st_sample, bit_object.end_sample);
                            ScanaStudio.dec_item_emphasize_warning();
                            ScanaStudio.dec_item_end();
                        }
                    }

                    decode_word(bit_object);
                }
                else
                {
                    ScanaStudio.dec_item_new(ch, trs_last.sample_index, trs.sample_index);
                    ScanaStudio.dec_item_add_content("WRONG BIT STATE");
                    ScanaStudio.dec_item_add_content("WRONG");
                    ScanaStudio.dec_item_add_content("!");
                    ScanaStudio.dec_item_emphasize_error();
                    ScanaStudio.dec_item_end();
                }
            }
            else if ((t >= (chip.t1l - chip.t_var)) && (t <= (chip.t1l + chip.t_var)))
            {
                if (t1h)
                {
                    bit_object.end_sample = trs.sample_index;
                    bit_object.value = 1;
                    t1h = false;
                    bit_cnt++;

                    if (chip.bit_time > 0)
                    {
                        if ((bit_object.end_sample - bit_object.st_sample) > (bit_time_max * sample_rate))
                        {
                            ScanaStudio.dec_item_new(ch, bit_object.st_sample, bit_object.end_sample);
                            ScanaStudio.dec_item_emphasize_warning();
                            ScanaStudio.dec_item_end();
                        }
                        else if ((bit_object.end_sample - bit_object.st_sample) < (bit_time_min * sample_rate))
                        {
                            ScanaStudio.dec_item_new(ch, bit_object.st_sample, bit_object.end_sample);
                            ScanaStudio.dec_item_emphasize_warning();
                            ScanaStudio.dec_item_end();
                        }
                    }

                    decode_word(bit_object);
                }
                else
                {
                    ScanaStudio.dec_item_new(ch, trs_last.sample_index, trs.sample_index);
                    ScanaStudio.dec_item_add_content("WRONG BIT STATE");
                    ScanaStudio.dec_item_add_content("WRONG");
                    ScanaStudio.dec_item_add_content("!");
                    ScanaStudio.dec_item_emphasize_error();
                    ScanaStudio.dec_item_end();
                }
            }
            else
            {
                ScanaStudio.dec_item_new(ch, trs_last.sample_index, trs.sample_index);
                ScanaStudio.dec_item_add_content("WRONG T1L/T0L DURATION");
                ScanaStudio.dec_item_add_content("WRONG");
                ScanaStudio.dec_item_add_content("!");
                ScanaStudio.dec_item_emphasize_error();
                ScanaStudio.dec_item_end();
            }
        }
    }
}

function decode_word (bit_object)
{
    var rgb = "";
    var bit_value = 0;
    var word_value = 0;
    var title = "", content = "";
    var title_clr = ScanaStudio.get_channel_color(ch);
    var content_clr = "";

    bitstream_arr.push(bit_object);

    if (bitstream_arr.length > 23)
    {
        for (i = 0; i < bitstream_arr.length; i++)
        {
            bit_value = bitstream_arr[i].value;
            word_value |= (bit_value << i);
        }

        rgb = word_value.toString(16).toUpperCase();

        if (chip.clr_order == "GRB")
        {
            rgb = (rgb.substr(2, 2) + rgb.substr(0, 2) + rgb.substr(4, 2));
        }

        word_cnt++;
        title = "LED " + word_cnt;
        content = "#" + rgb;
        content_clr = "#" + rgb;

        ScanaStudio.dec_item_new(ch, bitstream_arr[0].st_sample, bitstream_arr[23].end_sample);
        ScanaStudio.dec_item_add_content(title + ": " + content);
        ScanaStudio.dec_item_add_content(content);
        ScanaStudio.dec_item_end();

        ScanaStudio.packet_view_add_packet(false, ch, bitstream_arr[0].st_sample, bitstream_arr[23].end_sample, title, content, title_clr, content_clr);
        bitstream_arr = [];
    }
}

//Function called to generate demo siganls (when no physical device is attached)
function on_build_demo_signals()
{
    var builder = ScanaStudio.BuilderObject;
    var samples_to_build = ScanaStudio.builder_get_maximum_samples_count();
    var sample_rate = ScanaStudio.builder_get_sample_rate();
    var ch = ScanaStudio.gui_get_value("ch");
    var user_chip_id = Number(ScanaStudio.gui_get_value("chip_id"));
    var silence_period_samples = (samples_to_build / 10);
    var word = 0;
    var chip = null;

    for (var i in CHIPSETS_TABLE)
    {
        if (CHIPSETS_TABLE[i].chip_id == user_chip_id)
        {
            chip = CHIPSETS_TABLE[i];
        }
    }

    builder.config(ch, sample_rate, chip);
    builder.put_reset();

    while (ScanaStudio.builder_get_samples_acc(ch) < samples_to_build)
    {
        for (i = 0; i < 10; i++)
        {
            word = Math.floor(Math.random() * Math.floor(0xFFFFFF));
            builder.put_rgb(word);
        }

        builder.put_silence_samples(silence_period_samples);
    }
}

//Builder object that can be shared to other scripts
ScanaStudio.BuilderObject =
{
    //to be configured by the user of this object using the setter functions below
    channel: 0,
    chip: null,
    sample_rate: 0,

    put_rgb : function (word)
    {
        var i = 0;
        var bit_value = 0;

        for (i = 0; i < 24; i++)
        {
            bit_value = ((word >> i) & 0x1);
            this.put_bit(bit_value);
        }
    },

    put_bit : function (bit_value)
    {
        if (bit_value > 0)
        {
            ScanaStudio.builder_add_samples(this.channel, 1, (this.chip.t1h * this.sample_rate));
            ScanaStudio.builder_add_samples(this.channel, 0, (this.chip.t1l * this.sample_rate));
        }
        else
        {
            ScanaStudio.builder_add_samples(this.channel, 1, (this.chip.t0h * this.sample_rate));
            ScanaStudio.builder_add_samples(this.channel, 0, (this.chip.t0l * this.sample_rate));
        }
    },

    put_reset : function()
    {
        ScanaStudio.builder_add_samples(this.channel, 0, (this.chip.rst_time * this.sample_rate));
    },

    put_silence_samples : function (samples)
    {
        ScanaStudio.builder_add_samples(this.channel, 0, samples);
    },

    config : function (channel, sample_rate, chip)
    {
        this.channel = channel;
        this.sample_rate = sample_rate;
        this.chip = chip;
    },
};
