/* Protocol meta info:
<NAME> DHTxx </NAME>
<DESCRIPTION>
The digital temperature and humidity sensor DHT11 and DHT22 is a composite sensor that contains a calibrated digital signal output of temperature and humidity.
The technology of a dedicated digital modules collection and the temperature and humidity sensing technology are applied to ensure that the product has high reliability and excellent long-term stability.
The sensor includes a resistive sense of wet component and an NTC temperature measurement device, and is connected with a high-performance 8-bit microcontroller.
DHT22 has a larger range of temperature.
</DESCRIPTION>
<VERSION> 0.23 </VERSION>
<AUTHOR_NAME>  Nicolas BASTIT </AUTHOR_NAME>
<AUTHOR_URL> n.bastit@ikalogic.com </AUTHOR_URL>
<COPYRIGHT> Copyright Nicolas BASTIT </COPYRIGHT>
<LICENSE>  This code is distributed under the terms
of the GNU General Public License GPLv3 </LICENSE>
<RELEASE_NOTES>
V0.23: Added enforce timing constraint option.
V0.22: Added wrong timing display.
V0.21: Updated description.
V0.2: Added dec_item_end() for each dec_item_new().
V0.0:  Initial release.
</RELEASE_NOTES>
<HELP_URL>  </HELP_URL>
*/

function on_draw_gui_decoder()
{
    ScanaStudio.gui_add_ch_selector("ch","Channel to decode","DHTxx");

    ScanaStudio.gui_add_combo_box("sensor", "Sensor");
        ScanaStudio.gui_add_item_to_combo_box("DHT11", true);
        ScanaStudio.gui_add_item_to_combo_box("DHT22");

    ScanaStudio.gui_add_combo_box("tempUnit", "Temperature Units");
        ScanaStudio.gui_add_item_to_combo_box("Celsius", true);
        ScanaStudio.gui_add_item_to_combo_box("Fahrenheit");
        ScanaStudio.gui_add_item_to_combo_box("Kelvin");

    ScanaStudio.gui_add_check_box("strict_timing","Enforce strict dth11/22 timming constraint", false);
}

//times constants according to https://akizukidenshi.com/download/ds/aosong/AM2302.pdf
const   CONST_start_from_master_min         = 800e-6,
        CONST_DHT11_start_from_master_min   = 18e-3,
        CONST_start_from_master_max         = 20e-3,
        CONST_wait_for_response_min         = 20e-6,
        CONST_wait_for_response_max         = 200e-6,
        CONST_start_from_device_l_min       = 75e-6,
        CONST_start_from_device_l_max       = 85e-6,
        CONST_start_from_device_h_min       = 75e-6,
        CONST_start_from_device_h_max       = 85e-6,
        CONST_bit_low_min                   = 48e-6,
        CONST_bit_low_max                   = 55e-6,
        CONST_delay_between_bytes_max       = 20e-6,  //not specified into datasheet, but this delay is reel
        CONST_bit_high_0_min                = 22e-6,
        CONST_bit_high_0_max                = 30e-6,
        CONST_bit_high_1_min                = 68e-6,
        CONST_bit_high_1_max                = 75e-6,
        CONST_device_eof_min                = 45e-6,
        CONST_device_eof_max                = 55e-6;

const DHT11 =
{
    device_name             : "DHT11",
    temp_range_min_C        : 0,
    temp_range_max_C        : 50,
    rh_range_min            : 20,
    rh_range_max            : 90
};

const DHT22 =
{
    device_name             : "DHT22",
    temp_range_min_C        : -40,
    temp_range_max_C        : 150,
    rh_range_min            : 0,
    rh_range_max            : 100
};

const   ENUM_STATE_WAIT_FOR_START = 0,
        ENUM_STATE_START = 1,
        ENUM_STATE_WAIT_FOR_DHTxx = 2,
        ENUM_STATE_DHTxx_RESPONSE = 3,
        ENUM_STATE_RH_DATA_INT = 4,
        ENUM_STATE_RH_DATA_DEC = 5,
        ENUM_STATE_T_DATA_INT = 6,
        ENUM_STATE_T_DATA_DEC = 7,
        ENUM_STATE_CHECKSUM = 8,
        ENUM_STATE_UNDEFINED = 9;


const   COLOR_T_RH      = "#33FFFF",
        COLOR_C_RH      = "#99FFFF",
        COLOR_T_T       = "#FF66CC",
        COLOR_C_T       = "#FF99CC",
        COLOR_T_ERROR   = "#FF0000",
        COLOR_C_ERROR   = "#FF8080",
        COLOR_T_WARNING = "#FF6633",
        COLOR_C_WARNING = "#FF8653";

var DHTxx = DHT11;
var temperature_unit;
var channel;
var strict_timing;

var state_machine;
var sampling_rate;
var trs;
var last_trs;
var step_cnt;
var start_of_step;
var byte_value;
var byte_start;
var frame = [];

function reload_dec_gui_values()
{
    channel = Number(ScanaStudio.gui_get_value("ch") );
    if( Number(ScanaStudio.gui_get_value("sensor")) == 0 )
    {
        DHTxx = DHT11;
    }
    else
    {
        DHTxx = DHT22;
    }

    temperature_unit = Number(ScanaStudio.gui_get_value("tempUnit"));
    strict_timing = (ScanaStudio.gui_get_value("strict_timing") == "true");
    ScanaStudio.set_script_instance_name(DHTxx.device_name + " on CH" + (ScanaStudio.gui_get_value("ch")+1).toString());
}

function on_eval_gui_decoder()
{
    return "";
}


function on_decode_signals(resume)
{
    if (!resume)
    {
        //initialization code
        reload_dec_gui_values();
        state_machine = ENUM_STATE_WAIT_FOR_START;

        ScanaStudio.trs_reset(channel);
        trs = ScanaStudio.trs_get_next(channel);
        last_trs = trs;
        sampling_rate = ScanaStudio.get_capture_sample_rate();
        step_cnt = 0;
        start_of_step = 0;
        byte_value = 0;
        frame = [];
    }

    while (ScanaStudio.abort_is_requested() == false)
    {
        if (!ScanaStudio.trs_is_not_last(channel))
        {
            break;
        }

        switch(state_machine)
        {
            case ENUM_STATE_WAIT_FOR_START:
            {
                if( (trs.value==1)
                    && (DHTxx.device_name == DHT22.device_name)
                    && ((trs.sample_index - last_trs.sample_index)/sampling_rate >= CONST_start_from_master_min)
                    && ((trs.sample_index - last_trs.sample_index)/sampling_rate < CONST_start_from_master_max) )
                {
                    ScanaStudio.dec_item_new(channel, last_trs.sample_index, trs.sample_index);
                    ScanaStudio.dec_item_add_content("Start");
                    ScanaStudio.dec_item_add_content("S");
                    ScanaStudio.dec_item_end();

                    ScanaStudio.packet_view_add_packet(true,
                        channel,
                        last_trs.sample_index,
                        trs.sample_index,
                        DHTxx.device_name,
                        "CH" + (channel + 1),
                        "#0000FF",
                        "#8080FF");

                    state_machine = ENUM_STATE_WAIT_FOR_DHTxx;
                }
                else if( (trs.value==1)
                    && (DHTxx.device_name == DHT11.device_name)
                    && ((trs.sample_index - last_trs.sample_index)/sampling_rate >= CONST_DHT11_start_from_master_min)
                    && ((trs.sample_index - last_trs.sample_index)/sampling_rate < CONST_start_from_master_max) )
                {
                    ScanaStudio.dec_item_new(channel, last_trs.sample_index, trs.sample_index);
                    ScanaStudio.dec_item_add_content("Start");
                    ScanaStudio.dec_item_add_content("S");
                    ScanaStudio.dec_item_end();

                    ScanaStudio.packet_view_add_packet(true,
                        channel,
                        last_trs.sample_index,
                        trs.sample_index,
                        DHTxx.device_name,
                        "CH" + (channel + 1),
                        "#0000FF",
                        "#8080FF");

                    state_machine = ENUM_STATE_WAIT_FOR_DHTxx;
                }
                else
                {
                }
                break;
            }//end ENUM_STATE_WAIT_FOR_START


            case ENUM_STATE_WAIT_FOR_DHTxx:
            {
                if( (trs.value==0)
                    && ((trs.sample_index - last_trs.sample_index)/sampling_rate >= CONST_wait_for_response_min)
                    && ((trs.sample_index - last_trs.sample_index)/sampling_rate <= CONST_wait_for_response_max) )
                {
                    ScanaStudio.dec_item_new(channel, last_trs.sample_index, trs.sample_index);
                    ScanaStudio.dec_item_add_content("Wait for start DHTxx");
                    ScanaStudio.dec_item_add_content("Wait for start");
                    ScanaStudio.dec_item_add_content("Wait");
                    ScanaStudio.dec_item_end();

                    step_cnt = 0;
                    start_of_step = 0;

                    state_machine = ENUM_STATE_DHTxx_RESPONSE;
                }
                else
                {
                    state_machine = ENUM_STATE_WAIT_FOR_START;
                    ScanaStudio.packet_view_add_packet(false,
                        channel,
                        last_trs.sample_index,
                        trs.sample_index,
                        "Reset",
                        "error start from device",
                        COLOR_T_ERROR,
                        COLOR_C_ERROR);
                }
                break;
            }//end ENUM_STATE_WAIT_FOR_DHTxx


            case ENUM_STATE_DHTxx_RESPONSE:
            {
                if( (trs.value==1)
                    && ((trs.sample_index - last_trs.sample_index)/sampling_rate >= CONST_start_from_device_l_min)
                    && ((trs.sample_index - last_trs.sample_index)/sampling_rate <= CONST_start_from_device_l_max)
                    && (step_cnt==0) )
                {
                    start_of_step = last_trs.sample_index;
                    step_cnt++;
                    break;
                }
                else if( (trs.value==0)
                    && ((trs.sample_index - last_trs.sample_index)/sampling_rate >= CONST_start_from_device_h_min)
                    && ((trs.sample_index - last_trs.sample_index)/sampling_rate <= CONST_start_from_device_h_max)
                    && (step_cnt==1) )
                {
                    ScanaStudio.dec_item_new(channel, start_of_step, trs.sample_index);
                    ScanaStudio.dec_item_add_content("Start from DHTxx");
                    ScanaStudio.dec_item_add_content("Start DHTxx");
                    ScanaStudio.dec_item_add_content("Start");
                    ScanaStudio.dec_item_add_content("S");
                    ScanaStudio.dec_item_end();

                    step_cnt = 0;
                    start_of_step = 0;
                    byte_value = 0;
                    frame = [];
                    state_machine = ENUM_STATE_RH_DATA_INT;
                }
                else
                {
                    state_machine = ENUM_STATE_WAIT_FOR_START;
                    ScanaStudio.packet_view_add_packet(false,
                        channel,
                        last_trs.sample_index,
                        trs.sample_index,
                        "Reset",
                        "error start from device",
                        COLOR_T_ERROR,
                        COLOR_C_ERROR);
                }
                break;
            }//end ENUM_STATE_DHTxx_RESPONSE


            case ENUM_STATE_RH_DATA_INT:
            case ENUM_STATE_RH_DATA_DEC:
            case ENUM_STATE_T_DATA_INT:
            case ENUM_STATE_T_DATA_DEC:
            case ENUM_STATE_CHECKSUM:
            {
                if(step_cnt < 16)
                {
                    if( (trs.value==1)
                        && ((trs.sample_index - last_trs.sample_index)/sampling_rate >= CONST_bit_low_min)
                        && ( ((trs.sample_index - last_trs.sample_index)/sampling_rate <= CONST_bit_low_max)||((!strict_timing)&&((trs.sample_index - last_trs.sample_index)/sampling_rate <= CONST_bit_low_max + CONST_delay_between_bytes_max)) )
                        && (step_cnt%2==0) )
                    {
                        if( ((state_machine==ENUM_STATE_RH_DATA_INT) || (state_machine==ENUM_STATE_T_DATA_INT) || (state_machine==ENUM_STATE_CHECKSUM)) && (step_cnt==0) )
                        {
                            start_of_step = last_trs.sample_index;
                        }
                        // byte_start = last_trs.sample_index;
                        step_cnt++;
                    }
                    else if( (trs.value==0)
                        && ((trs.sample_index - last_trs.sample_index)/sampling_rate >= CONST_bit_high_0_min)
                        && ((trs.sample_index - last_trs.sample_index)/sampling_rate <= CONST_bit_high_0_max)
                        && (step_cnt%2==1) )
                    {
                        //bit value is 0
                        byte_value = byte_value<<1;
                        step_cnt++;

                        // ScanaStudio.dec_item_new(channel, byte_start, trs.sample_index);
                        // ScanaStudio.dec_item_add_content("0");
                        // ScanaStudio.dec_item_end();
                    }
                    else if( (trs.value==0)
                        && ((trs.sample_index - last_trs.sample_index)/sampling_rate >= CONST_bit_high_1_min)
                        && ((trs.sample_index - last_trs.sample_index)/sampling_rate <= CONST_bit_high_1_max)
                        && (step_cnt%2==1) )
                    {
                        //bit value is 1
                        byte_value = (byte_value<<1) | 0x01;
                        step_cnt++;

                        // ScanaStudio.dec_item_new(channel, byte_start, trs.sample_index);
                        // ScanaStudio.dec_item_add_content("1");
                        // ScanaStudio.dec_item_end();
                    }
                    else
                    {
                        //error
                        state_machine = ENUM_STATE_WAIT_FOR_START;
                        ScanaStudio.packet_view_add_packet(false,
                            channel,
                            last_trs.sample_index,
                            trs.sample_index,
                            "Reset",
                            "error while reading data",
                            COLOR_T_ERROR,
                            COLOR_C_ERROR);
                        ScanaStudio.dec_item_new(channel, last_trs.sample_index, trs.sample_index);
                        ScanaStudio.dec_item_add_content("Timing ERROR");
                        ScanaStudio.dec_item_add_content("ERROR");
                        ScanaStudio.dec_item_add_content("!");
                        ScanaStudio.dec_item_emphasize_error();
                        ScanaStudio.dec_item_end();
                        break;
                    }



                    if(step_cnt == 16)
                    {
                        if( (state_machine >= ENUM_STATE_RH_DATA_INT) && (state_machine < ENUM_STATE_CHECKSUM) )
                        {
                            frame.push(byte_value);

                            if( state_machine==ENUM_STATE_RH_DATA_DEC )
                            {
                                var val;
                                if(DHTxx.device_name == DHT11.device_name)
                                {
                                    val = frame[frame.length-2] + frame[frame.length-1]/100;
                                }
                                else if(DHTxx.device_name == DHT22.device_name)
                                {
                                    val = (frame[frame.length-2]<<8 | frame[frame.length-1])/10;
                                }

                                ScanaStudio.dec_item_new(channel, start_of_step, trs.sample_index);
                                ScanaStudio.dec_item_add_content("Relative Humidity : " + val + "%");
                                ScanaStudio.dec_item_add_content("RH : " + val + "%");
                                ScanaStudio.dec_item_add_content(val + "%");

                                if( (val < DHTxx.rh_range_min) || (val > DHTxx.rh_range_max) )
                                {
                                    ScanaStudio.dec_item_emphasize_warning();
                                    ScanaStudio.packet_view_add_packet(false,
                                        channel,
                                        start_of_step,
                                        trs.sample_index,
                                        "Temp :",
                                        val + unity + " is out of device range !",
                                        COLOR_T_WARNING,
                                        COLOR_C_WARNING);
                                }
                                else
                                {
                                    ScanaStudio.packet_view_add_packet(false,
                                        channel,
                                        start_of_step,
                                        trs.sample_index,
                                        "RH :",
                                        val + "%",
                                        COLOR_T_RH,
                                        COLOR_C_RH);
                                }

                                ScanaStudio.dec_item_end();
                            }
                            else if (state_machine==ENUM_STATE_T_DATA_DEC)
                            {
                                var unity = "°C";
                                var val, val_mod;

                                if (DHTxx.device_name == DHT11.device_name)
                                {
                                    val = frame[frame.length-2] + frame[frame.length-1]/100;
                                }
                                else if (DHTxx.device_name == DHT22.device_name)
                                {
                                    val = ((frame[frame.length-2] & 0x7F)<<8 | frame[frame.length-1]) / 10;

                                    if ((frame[frame.length-2]>>7)==0x01)
                                    {
                                        val = -val;
                                    }
                                }

                                switch (temperature_unit)
                                {
                                    default:
                                    case 0://Celsius
                                        //all is already done
                                        val_mod = val;
                                        break;

                                    case 1://Farenheit
                                        val_mod + val + 273.15;
                                        unity = "K";
                                        break;

                                    case 2://Kelvin
                                        val_mod = (val * 9/5) + 32;
                                        unity = "°F";
                                        break;
                                }

                                ScanaStudio.dec_item_new(channel, start_of_step, trs.sample_index);
                                ScanaStudio.dec_item_add_content("Temperature : " + val + unity);
                                ScanaStudio.dec_item_add_content("T : " + val + unity);
                                ScanaStudio.dec_item_add_content(val + unity);

                                if ((val < DHTxx.temp_range_min_C) || (val > DHTxx.temp_range_max_C))
                                {
                                    ScanaStudio.dec_item_emphasize_warning();
                                    ScanaStudio.dec_item_end();

                                    ScanaStudio.packet_view_add_packet(false,
                                        channel,
                                        start_of_step,
                                        trs.sample_index,
                                        "Temp :",
                                        val + unity + " is out of device range !",
                                        COLOR_T_WARNING,
                                        COLOR_C_WARNING);
                                }
                                else
                                {
                                    ScanaStudio.packet_view_add_packet(false,
                                        channel,
                                        start_of_step,
                                        trs.sample_index,
                                        "Temp :",
                                        val + unity,
                                        COLOR_T_T,
                                        COLOR_C_T);
                                }

                                ScanaStudio.dec_item_end();
                            }

                            byte_value = 0;
                            step_cnt = 0;
                            state_machine++;
                        }
                        else if (state_machine == ENUM_STATE_CHECKSUM)
                        {
                            var chk_sum = 0;

                            for(var i=0; i<4; i++)
                            {
                                chk_sum += frame[i];
                            }

                            chk_sum = chk_sum & 0xFF;

                            ScanaStudio.dec_item_new(channel, start_of_step, trs.sample_index);

                            if (chk_sum == byte_value)
                            {
                                ScanaStudio.dec_item_add_content("Check-sum OK " + dec_to_str(byte_value, "0x"));
                                ScanaStudio.dec_item_add_content(dec_to_str(byte_value, "0x") + " OK");
                                ScanaStudio.dec_item_add_content(dec_to_str(byte_value, "0x"));
                            }
                            else
                            {
                                ScanaStudio.dec_item_add_content("Wrong Check-sum " + dec_to_str(byte_value, "0x") + " should be " + dec_to_str(chk_sum, "0x"));
                                ScanaStudio.dec_item_add_content("Wrong Check-sum " + dec_to_str(byte_value, "0x"));
                                ScanaStudio.dec_item_add_content("!" + dec_to_str(byte_value, "0x"));

                                ScanaStudio.packet_view_add_packet(false,
                                    channel,
                                    start_of_step,
                                    trs.sample_index,
                                    "CHKSUM",
                                    "Wrong Check-sum " + dec_to_str(byte_value, "0x") + " should be " + dec_to_str(chk_sum, "0x"),
                                    COLOR_T_ERROR,
                                    COLOR_C_ERROR);
                            }

                            ScanaStudio.dec_item_end();
                            state_machine = ENUM_STATE_WAIT_FOR_START;
                        }
                    }
                }
                else
                {
                    state_machine = ENUM_STATE_WAIT_FOR_START;
                    ScanaStudio.packet_view_add_packet(false,
                        channel,
                        last_trs.sample_index,
                        trs.sample_index,
                        "Reset",
                        "error while reading data",
                        COLOR_T_ERROR,
                        COLOR_C_ERROR);
                }
                break;
            }
        }

        last_trs = trs;
        trs = ScanaStudio.trs_get_next(channel);
    }
}

function on_build_demo_signals()
{
    var samples_to_build = ScanaStudio.builder_get_maximum_samples_count();
    var dhtxx_builder = ScanaStudio.BuilderObject;

    reload_dec_gui_values();

    dhtxx_builder.config(channel, DHTxx, ScanaStudio.builder_get_sample_rate());
    dhtxx_builder.put_silence(0.01);

    while (ScanaStudio.builder_get_samples_acc(channel) < samples_to_build)
    {
        var rng_temp = Math.random() * (DHTxx.temp_range_max_C - DHTxx.temp_range_min_C) + DHTxx.temp_range_min_C;
        var rng_rh = Math.random() * (DHTxx.rh_range_max - DHTxx.rh_range_min) + DHTxx.rh_range_min;

        dhtxx_builder.put_frame_device(rng_rh, rng_temp);
        dhtxx_builder.put_silence(1);
    }
}

//Builder object that can be shared to other scripts
ScanaStudio.BuilderObject =
{
    config : function (_ch, _DHTxx, sample_rate)
    {
        this.DHTxx = _DHTxx;
        this.ch = _ch;
        this.sample_rate = sample_rate;
        ScanaStudio.builder_add_samples(this.ch, 1, 0);
    },

    put_silence : function (duration_s)
    {
        var samples_count = duration_s * this.sample_rate;

        if (samples_count == 0)
        {
            samples_count = 1;
        }

        ScanaStudio.builder_add_samples(this.ch, 1, samples_count);
    },

    put_start_from_master : function()
    {
        var wait_for_response_s = Math.random() * (CONST_wait_for_response_max - CONST_wait_for_response_min) + CONST_wait_for_response_min;
        var start_from_master_s;

        if (this.DHTxx.device_name == DHT11.device_name)
        {
            start_from_master_s = Math.random() * (CONST_start_from_master_max - CONST_DHT11_start_from_master_min) + CONST_DHT11_start_from_master_min;
        }
        else
        {
            start_from_master_s = Math.random() * (CONST_start_from_master_max - CONST_start_from_master_min) + CONST_start_from_master_min;
        }

        var samples_start_count = start_from_master_s * this.sample_rate;
        var samples_wait_count = wait_for_response_s * this.sample_rate;
        ScanaStudio.builder_add_samples(this.ch, 0, samples_start_count);
        ScanaStudio.builder_add_samples(this.ch, 1, samples_wait_count);
    },

    put_start_from_device : function()
    {
        var count_l_s = Math.random() * (CONST_start_from_device_l_max - CONST_start_from_device_l_min) + CONST_start_from_device_l_min;
        var count_h_s = Math.random() * (CONST_start_from_device_h_max - CONST_start_from_device_h_min) + CONST_start_from_device_h_min;
        var samples_count_l = count_l_s * this.sample_rate;
        var samples_count_h = count_h_s * this.sample_rate;

        ScanaStudio.builder_add_samples(this.ch, 0, samples_count_l);
        ScanaStudio.builder_add_samples(this.ch, 1, samples_count_h);
    },

    put_bit_from_device : function(bit)
    {
        var count_start_of_bit = Math.random() * (CONST_bit_low_max - CONST_bit_low_min) + CONST_bit_low_min;
        var samples_count_start_of_bit = count_start_of_bit * this.sample_rate;
        var samples_count_highlvl;
        var rng_len;

        if (bit == 0)
        {
            rng_len = Math.random() * (CONST_bit_high_0_max - CONST_bit_high_0_min) + CONST_bit_high_0_min;
        }
        else
        {
            rng_len = Math.random() * (CONST_bit_high_1_max - CONST_bit_high_1_min) + CONST_bit_high_1_min;
        }

        samples_count_highlvl = rng_len * this.sample_rate;
        ScanaStudio.builder_add_samples(this.ch, 0, samples_count_start_of_bit);
        ScanaStudio.builder_add_samples(this.ch, 1, samples_count_highlvl);
    },

    put_char_from_device : function(char)
    {
        for (var i=7; i>=0; i--)
        {
            this.put_bit_from_device((char >> i) & 0x01);   // MSB first
        }
    },

    put_eof_from_device : function()
    {
        var eof_s = Math.random()*(CONST_device_eof_max - CONST_device_eof_min) + CONST_device_eof_min;
        var samples_count_eof = eof_s * this.sample_rate;
        ScanaStudio.builder_add_samples(this.ch, 0, samples_count_eof);
        ScanaStudio.builder_add_samples(this.ch, 1, 1);     // Release the channel
    },

    put_frame_device : function(relative_humidity, temperature_C)
    {
        var RH_int = 0;
        var RH_dec = 0;
        var T_int = 0;
        var T_dec = 0;
        var chk_sum = 0;

        if (relative_humidity>100)
        {
            relative_humidity = 100;
        }
        if (relative_humidity<0)
        {
            relative_humidity = 0;
        }

        if (DHTxx.device_name == DHT11.device_name)
        {
            RH_int = Math.floor(relative_humidity);
            RH_dec = Math.floor(relative_humidity*100 - RH_int*100);

            T_int = Math.floor(temperature_C);
            T_dec = Math.floor( temperature_C*100 - T_int*100);
        }
        else if (DHTxx.device_name == DHT22.device_name)
        {
            RH_int = (Math.floor(relative_humidity * 10) >> 8) & 0xFF;
            RH_dec = Math.floor(relative_humidity * 10) & 0xFF;

            if (temperature_C < 0)
            {
                temperature_C = -temperature_C;
                T_int = (Math.floor(temperature_C * 10) >> 8) & 0x7F;
                T_int |= 0x80;
                T_dec = Math.floor(temperature_C * 10) & 0xFF;
            }
            else
            {
                T_int = (Math.floor(temperature_C * 10) >> 8) & 0x7F;
                T_dec = Math.floor(temperature_C * 10) & 0xFF;
            }
        }

        chk_sum = RH_int + RH_dec + T_int + T_dec;
        chk_sum = chk_sum & 0xFF;

        this.put_start_from_master();
        this.put_start_from_device();
        this.put_char_from_device(RH_int);
        this.put_char_from_device(RH_dec);
        this.put_char_from_device(T_int);
        this.put_char_from_device(T_dec);
        this.put_char_from_device(chk_sum);
        this.put_eof_from_device();
    },
};

function dec_to_str (dec, prefix)
{
    var str = "";
    str += prefix;

    if (dec < 16)
    {
        str += "0";
    }

    str += dec.toString(16).toUpperCase();
    return str;
}
