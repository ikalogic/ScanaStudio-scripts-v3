/* Protocol meta info:
<NAME> Manchester Encoding </NAME>
<DESCRIPTION>
Manchester code is a line code in which the encoding of each data bit is either low then high, or high then low, for equal time
</DESCRIPTION>
<VERSION> 0.1 </VERSION>
<AUTHOR_NAME>  Vladislav Kosinov </AUTHOR_NAME>
<AUTHOR_URL> v.kosinov@ikalogic.com </AUTHOR_URL>
<HELP_URL> https://github.com/ikalogic/ScanaStudio-scripts-v3/wiki </HELP_URL>
<COPYRIGHT> Copyright 2019 Ikalogic SAS </COPYRIGHT>
<LICENSE>  This code is distributed under the terms of the GNU General Public License GPLv3 </LICENSE>
<RELEASE_NOTES>
V0.1:  Initial release.
</RELEASE_NOTES>
*/

const decode_state =
{
    SYNC: 'sync',
    BITSTREAM: 'bitstream'
}

//Global variables
var ch;
var invert;
var order;
var sampling_rate;
var state_machine;
var bitstream_arr = [];
var sync_bitstream_arr = [];
var hexview_bitstream_arr = [];
var bit_object_last;
var trs, trs_last;
var t, t1, t2;

var BIT_TYPE =
{
	ONE_T : 0x01,
	TWO_T : 0x02
};

function BitObject (value, type, sample_index)
{
	this.value = value;
    this.type = type;
	this.sample_index = sample_index;
};

//Decoder GUI
function on_draw_gui_decoder()
{
    //Define decoder configuration GUI
    ScanaStudio.gui_add_ch_selector("ch", "Select channel to decode", "Manchester");

    ScanaStudio.gui_add_check_box("skip_first_trs","Skip first transition", false);

    ScanaStudio.gui_add_new_tab("Advanced options", false);

    ScanaStudio.gui_add_combo_box("invert","Encoding convention");
        ScanaStudio.gui_add_item_to_combo_box("1 is expressed by low-to-high transition", true);
        ScanaStudio.gui_add_item_to_combo_box("1 is expressed by high-to-low transition", false);

    ScanaStudio.gui_add_combo_box("order", "HexView bit order");
        ScanaStudio.gui_add_item_to_combo_box("LSB first", true);
        ScanaStudio.gui_add_item_to_combo_box("MSB first", false);
}

function on_decode_signals (resume)
{
    if (!resume) //If resume == false, it's the first call to this function.
    {
        state_machine = decode_state.SYNC;
        sampling_rate = ScanaStudio.get_capture_sample_rate();
        ch = Number(ScanaStudio.gui_get_value("ch"));
        invert = Number(ScanaStudio.gui_get_value("invert"));
        order = Number(ScanaStudio.gui_get_value("order"));
        bit_object_last = null;
        t  = 0;
        t1 = 0;
        t2 = 0;

        ScanaStudio.trs_reset(ch);
        var skip_first_trs = Number(ScanaStudio.gui_get_value("skip_first_trs"));

		trs = ScanaStudio.trs_get_next(ch);
        trs_last = trs;
    }

    while (ScanaStudio.trs_is_not_last(ch))
    {
        if (ScanaStudio.abort_is_requested())
        {
            return;
        }

        switch (state_machine)
        {
            case decode_state.SYNC:

                if (skip_first_trs)
                {
                    skip_first_trs = false;
                    trs = ScanaStudio.trs_get_next(ch);
                    trs_last = trs;
                    break;
                }

                trs_last = trs;
                trs = ScanaStudio.trs_get_next(ch);
                sync_bitstream_arr.push(trs);

                if (trs_last != null)
                {
                    t = (trs.sample_index - trs_last.sample_index);

                    if ((t1 > 0) && (t2 > 0))
                    {
                        if (t > t1)
                        {
                            t2 = t;
                        }
                        else if (t < t1)
                        {
                            t2 = t1;
                            t1 = t;
                        }

                        if ((t2 >= (t1 * 2) - get_t_margin(t1 * 2)) && (t2 <= (t1 * 2) + get_t_margin(t1 * 2)))
                        {
                            state_machine = decode_state.BITSTREAM;
                        }
                    }
                    else
                    {
                        t1 = t;
                        t2 = t;
                    }
                }

            break;

            case decode_state.BITSTREAM:

                if (sync_bitstream_arr.length > 0)
                {
                    trs = sync_bitstream_arr.shift();

                    while (sync_bitstream_arr.length > 0)
                    {
                        trs_last = trs;
                        trs = sync_bitstream_arr.shift();
                        decode_bit(trs_last, trs);
                    }
                }

				trs_last = trs;
                trs = ScanaStudio.trs_get_next(ch);
                decode_bit(trs_last, trs);

            break;

            default: return;
        }
    }
}

function decode_bit (trs_st, trs_end)
{
    var bit_object = null;
    var bit_value = 0;

    t = (trs_end.sample_index - trs_st.sample_index);

    if ((t < (t1 + get_t_margin(t1))) && (t > (t1 - get_t_margin(t1))))
    {
        bitstream_arr.push(new BitObject(trs_end.value, BIT_TYPE.ONE_T, trs_end.sample_index));
    }

    if ((t < (t2 + get_t_margin(t2))) && (t > (t2 - get_t_margin(t2))))
    {
        bitstream_arr.push(new BitObject(trs_st.value, BIT_TYPE.TWO_T, trs_st.sample_index));
        bitstream_arr.push(new BitObject(trs_end.value, BIT_TYPE.TWO_T, trs_end.sample_index));
    }

    if (bitstream_arr.length > 1)
    {
        bit_object = bitstream_arr.shift();
        var temp_object = bitstream_arr.shift();

        if (temp_object.type == BIT_TYPE.TWO_T)
        {
            if (temp_object.value != bit_object.value)
            {
                bitstream_arr.unshift(temp_object);
            }
        }

        if (invert)
        {
            bit_object.value ^= 1;
        }

        ScanaStudio.dec_item_new(ch, (bit_object.sample_index - (t1 / 2)), (bit_object.sample_index + (t1 / 2)));
        ScanaStudio.dec_item_add_content(bit_object.value);
        decode_byte(bit_object);
    }
}

function decode_byte (bit_object)
{
    var i = 0;
    var bit_value = 0;
    var byte_value = 0;

    hexview_bitstream_arr.push(bit_object);

    if (hexview_bitstream_arr.length > 7)
    {
        for (i = 0; i < hexview_bitstream_arr.length; i++)
        {
            bit_value = hexview_bitstream_arr[i].value;
            byte_value |= (bit_value << i);
        }

        if (order)
        {
            byte_value = reverse_bits(byte_value);
        }

        ScanaStudio.hex_view_add_byte(ch, hexview_bitstream_arr[0].sample_index, hexview_bitstream_arr[7].sample_index, byte_value);
        hexview_bitstream_arr = [];
    }
}

function reverse_bits (byte_value)
{
    var out = 0;

    if (byte_value & 0x01) out |= 0x80;
    if (byte_value & 0x02) out |= 0x40;
    if (byte_value & 0x04) out |= 0x20;
    if (byte_value & 0x08) out |= 0x10;
    if (byte_value & 0x10) out |= 0x08;
    if (byte_value & 0x20) out |= 0x04;
    if (byte_value & 0x40) out |= 0x02;
    if (byte_value & 0x80) out |= 0x01;

    return out;
}

function get_t_margin (samples)
{
	return ((samples / 100) * 35);
}

//Function called to generate demo siganls (when no physical device is attached)
function on_build_demo_signals()
{
    var builder = ScanaStudio.BuilderObject;
    var ch = ScanaStudio.gui_get_value("ch");
    var invert = ScanaStudio.gui_get_value("invert");
    var samples_to_build = ScanaStudio.builder_get_maximum_samples_count();
    var sample_rate = ScanaStudio.builder_get_sample_rate();
    var silence_period_samples = 1000 + (samples_to_build / 10);
    var baud_rate = 1000;
    var data = 0;

    builder.config(ch, sample_rate, baud_rate);

    while (ScanaStudio.builder_get_samples_acc(ch) < samples_to_build)
    {
        builder.put_byte(data);
        data = Math.floor(Math.random() * Math.floor(0xFF));
    }
}

//Builder object that can be shared to other scripts
ScanaStudio.BuilderObject =
{
    //to be configured by the user of this object using the setter functions below
    channel: 0,
    samples_per_bit: 0,

    put_byte : function(byte)
    {
        var i;
        var bit_value;

        for (i = 0; i < 8; i++)
        {
            bit_value = ((byte >> i) & 0x1);
            this.put_bit(bit_value);
        }
    },

    put_bit : function(bit_value)
    {
        if (bit_value > 1)
        {
            bit_value = 1;
        }

        if (bit_value)
        {
            ScanaStudio.builder_add_samples(this.channel, 0, (this.samples_per_bit / 2));
            ScanaStudio.builder_add_samples(this.channel, 1, (this.samples_per_bit / 2));
        }
        else
        {
            ScanaStudio.builder_add_samples(this.channel, 1, (this.samples_per_bit / 2));
            ScanaStudio.builder_add_samples(this.channel, 0, (this.samples_per_bit / 2));
        }
    },

    put_silence_samples : function(samples)
    {
        ScanaStudio.builder_add_samples(this.channel, 0, samples);
    },

    config : function(channel, sample_rate, baud_rate)
    {
        this.channel = channel;
        this.sample_rate = sample_rate;
        this.samples_per_bit = Math.floor(sample_rate / baud_rate);
    },
};
