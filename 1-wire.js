/* Protocol meta info:
<NAME> 1-Wire </NAME>
<DESCRIPTION>
1-Wire protocol analyzer. Decodes Reset, presence and byte fields.
</DESCRIPTION>
<VERSION> 0.8 </VERSION>
<AUTHOR_NAME> BASTIT Nicolas </AUTHOR_NAME>
<AUTHOR_URL> n.bastit@ikalogic.com </AUTHOR_URL>
<HELP_URL> https://github.com/ikalogic/ScanaStudio-scripts-v3/wiki </HELP_URL>
<COPYRIGHT> Copyright BASTIT Nicolas </COPYRIGHT>
<LICENSE> This code is distributed under the terms of the GNU General Public License GPLv3 </LICENSE>
<RELEASE_NOTES>
v0.8: fixed bug related to incrementaiton
V0.7: new skin
V0.6: Added trigger capability
V0.5: Added packet and hex views
V0.2: Added dec_item_end() for each dec_item_new().
V0.1: Fixed sampling point position for presence pulse.
V0.0: Initial release.
</RELEASE_NOTES>
*/

/*
*************************************************************************************
							    GLOBAL VARIABLES
*************************************************************************************
*/

var DEBUG_SCOPES =
{
	BIT_STREAM 	: 0x01,
	DECODER		: 0x02,
	DECODER_FSM	: 0x03,
};

var STATE =
{
	INIT        : 0x00,
	RESET       : 0x01,
	PRESENCE    : 0x02,
	ROM_COMMAND : 0x04,
	SHOW_ROM    : 0x08,
	SEARCH_ROM  : 0x16,
	DATA        : 0x32,
	END         : 0x64
};

var ROM_CMD =
{
	READ_ROM      : {code: 0x33, str: "READ ROM "},
	MATCH_ROM     : {code: 0x55, str: "MATCH ROM "},
	OVD_MATCH_ROM : {code: 0x69, str: "OVERDRIVE MATCH ROM "},
	SKIP_ROM      : {code: 0xCC, str: "SKIP ROM "},
	OVD_SKIP_ROM  : {code: 0x3C, str: "OVERDRIVE SKIP ROM "},
	SEARCH_ROM    : {code: 0xF0, str: "SEARCH ROM "},
	ALARM_SEARCH  : {code: 0xEC, str: "ALARM SEARCH "}
};

var MEM_CMD =
{
    WRITE_SCRATCH   : {code: 0x0F, str: "WRITE SCRATCHPAD "},
    READ_SCRATCH    : {code: 0xAA, str: "READ SCRATCHPAD "},
    COPY_SCRATCH    : {code: 0x55, str: "WRITE SCRATCHPAD "},
    READ_MEMORY     : {code: 0xF0, str: "READ MEMORY "},
    EXT_READ_MEMORY : {code: 0x0F, str: "EXTENDED READ MEMORY "},
}

var ROM_CMD_READ_ROM = 0x33;
var ROM_CMD_MATCH_ROM = 0x55;
var ROM_CMD_OVD_MATCH_ROM = 0x69;
var ROM_CMD_SKIP_ROM = 0xCC;
var ROM_CMD_OVD_SKIP_ROM = 0x3C;
var ROM_CMD_SEARCH_ROM = 0xF0;
var ROM_CMD_ALARM_SEARCH = 0xEC;

var OWOBJECT_TYPE =
{
	RESET    : 0x01,
	PRESENCE : 0x02,
	BIT      : 0x04,
	BYTE     : 0x08,
	UNKNOWN  : 0x16
};

var DEVICE_FAMILY =
{
	DS1990   : {code: 0x01, str: "DS1990(A)/DS2401"},    // Serial number iButton
	DS1991   : {code: 0x02, str: "DS1991"},              // Multikey iButton
	DS1994   : {code: 0x04, str: "DS1994/DS2404"},       // 4k-bit NV RAM memory + clock + timer + alarms iButton
	DS2405   : {code: 0x05, str: "DS2405"},              // Single addressable switch
	DS1993   : {code: 0x06, str: "DS1993"},              // 4k-bit NV RAM memory iButton
	DS1992   : {code: 0x08, str: "DS1992"},              // 1k-bit NV RAM memory iButton
	DS1982   : {code: 0x09, str: "DS1982/DS2502"},       // 1k-bit EPROM uniqueWare iButton
	DS1995   : {code: 0x0A, str: "DS1995"},              // 16k-bit NV RAM memory iButton
	DS1985   : {code: 0x0B, str: "DS1985/DS2505"},       // 16k-bit EPROM memory
	DS1996   : {code: 0x0C, str: "DS1996"},              // 64k-bit NV RAM memory iButton
	DS1986   : {code: 0x0F, str: "DS1986/DS2506"},       // 64k-bit EPROM memory
	DS2502   : {code: 0x09, str: "DS2502"},              // 1k-bit EPROM memory
	DS1820   : {code: 0x10, str: "DS1820/DS18S20/DS1920"},	// Digital thermometer
	DS2406   : {code: 0x12, str: "DS2406/DS2407"}, 	     // Dual addressable switch + 1k-bit EPROM memory
	DS1971   : {code: 0x14, str: "DS1971/DS2430"},       // 256-bit EEPROM iButton
	DS1963   : {code: 0x1A, str: "DS1963(L)"},           // 4k-bit monetary iButton
	DS2436   : {code: 0x1B, str: "DS2436"},              // Battery ID/monitor chip
	DS2422   : {code: 0x1C, str: "DS2422"},              // 1k-bit NV RAM with ext-counters
	DS2423   : {code: 0x1D, str: "DS242"},               // 4k-bit NV RAM with ext-counters
	DS2437   : {code: 0x1E, str: "DS2437"},              // Smart battery monitor
	DS2409   : {code: 0x1F, str: "DS2409"},              // Microlan coupler
	DS1962   : {code: 0x18, str: "DS1962"},              // 1k-bit monetary iButton
	DS2450   : {code: 0x20, str: "DS2450"},              // Quad A/D converter
	DS1921   : {code: 0x21, str: "DS1921"},              // Temperature recorder iButton
	DS1822   : {code: 0x22, str: "DS1822"},              // Econo digital thermometer
	DS1973   : {code: 0x23, str: "DS1973/DS2433"},       // 4k-bit EEPROM iButton
	DS1904   : {code: 0x24, str: "DS1904/DS2415"},       // Real-time clock
	DS2438   : {code: 0x26, str: "DS2438"},              // Digital thermometer + A/D converter
	DS2417   : {code: 0x27, str: "DS2417"},       		 // RTC with interrupt
	DS18B20  : {code: 0x28, str: "DS18B20/MAX31820"},    // Digital thermometer
	DS2408   : {code: 0x29, str: "DS2408"},              // 8-ch addressable switch
	DS2760   : {code: 0x30, str: "DS2760"},              // Digital thermometer + A/D converter + current sensor
	DS2890   : {code: 0x2C, str: "DS2890"},              // Single digital potentiometer
	DS2431   : {code: 0x2D, str: "DS1972/DS2431"},       // 1024-bit, 1-Wire EEPROM
	DS1977   : {code: 0x37, str: "DS1977"},     		 // Password-protected 32KB (bytes) EEPROM
	DS2413   : {code: 0x3A, str: "DS2413"},   			 // 2-channel addressable switch
	DS1825   : {code: 0x3B, str: "DS1825/MAX31826/MAX318(50/51)"}, 	// Digital Thermometer
	DS2422   : {code: 0x41, str: "DS2422"},              // High-capacity Thermochron (temperature/humidity) loggers
	DS28EA00 : {code: 0x42, str: "DS28EA00"},            // Digital thermometer
	DS28EC20 : {code: 0x43, str: "DS28EC20"},            // 20Kb 1-Wire EEPROM
	DS1420   : {code: 0x81, str: "DS1420"},              // Serial ID Button
	DS1425   : {code: 0x82, str: "DS1425"},     		 // Multi iButton
	DS1427   : {code: 0x84, str: "DS1427"}               // Time iButton
};

var STANDARD_DELAYS =
{
	// RESET AND PRESENCE PULSE
	RSTL_STD : 480,
	RSTL_MIN : 380,
	PDH_MIN  : 15,
	PDH_MAX  : 60,
	PDL_MIN  : 60,
	PDL_MAX  : 240,

	// TIME SLOTS
	SLOT_MIN : 60,
	SLOT_MAX : 120,
	REC_MIN  : 1,

	// WRITE 1 TIME SLOT
	LOW1_MIN : 1,
	LOW1_MAX : 15,

	// WRITE 0 TIME SLOT
	LOW0_MIN : 60,
	LOW0_MAX : 120,

	// READ TIME SLOTS
	LOWR_MIN : 1,
	LOWR_MAX : 15,
	REL_MIN  : 0,
	REL_MAX  : 45,
	RDV      : 15
};

var OVERDRIVE_DELAYS =
{
	// RESET AND PRESENCE PULSE
	RSTL_MIN : 48,
	RSTL_MAX : 80,
	PDH_MIN  : 2,
	PDH_MAX  : 6,
	PDL_MIN  : 8,
	PDL_MAX  : 24,

	// TIME SLOTS
	SLOT_MIN : 6,
	SLOT_MAX : 16,
	REC_MIN  : 1,

	// WRITE 1 TIME SLOT
	LOW1_MIN : 1,
	LOW1_MAX : 2,

	// WRITE 0 TIME SLOT
	LOW0_MIN : 6,
	LOW0_MAX : 16,

	// READ TIME SLOTS
	LOWR_MIN : 1,
	LOWR_MAX : 2,
	REL_MIN  : 0,
	REL_MAX  : 4,
	RDV      : 2
};

var SPEED =
{
	REGULAR   : 0,
	OVERDRIVE : 1,
	UNKNOWN   : 2
};

var HEXVIEW_OPT =
{
	DATA : 0x00,
	ROM  : 0x01,
	ADR  : 0x02,
	ALL  : 0x03
};

/* Object definitions
*/
function OWObject (type, value, start, end, duration, isLast)
{
	this.type = type;
	this.value = value;
	this.start = start;
	this.end = end;
	this.duration = duration;
	this.isLast = isLast;
};

function PktObject (title, titleColor, data, dataLen, dataObjArr, dataColor, start, end)
{
	this.start = start;
	this.end = end;
	this.title = title;
	this.data = data;
	this.dataLen = dataLen;
	this.dataObjArr = dataObjArr;
	this.titleColor = titleColor;
	this.dataColor = dataColor;
};

var g_oWDelays;
var g_owObjects;
var g_pktObjects;
var g_samples_per_us;

var PKT_COLOR_DATA;
var PKT_COLOR_DATA_TITLE;
var PKT_COLOR_RESET_TITLE;
var PKT_COLOR_PRES_TITLE;
var PKT_COLOR_ROMCMD_TITLE;
var PKT_COLOR_ROMCODE_TITLE;
var PKT_COLOR_UNKNW_TITLE;
var PKT_COLOR_OTHER_TITLE;
var PKT_COLOR_INVALID;

var g_ch;
var g_speed;
var g_format;
var g_suffix;
var g_sampling_rate;
var g_state;
var g_next_trs;
var g_byte_sample_points = [];

//Decoder GUI
function on_draw_gui_decoder()
{
    //Define decoder configuration GUI
    ScanaStudio.gui_add_ch_selector("ch","Channel to decode","1-Wire");

    ScanaStudio.gui_add_combo_box("speed","1-Wire Speed")
        ScanaStudio.gui_add_item_to_combo_box("Regular speed",true);
        ScanaStudio.gui_add_item_to_combo_box("Overdrive speed",false);

    ScanaStudio.gui_add_combo_box("format","Display format")
        ScanaStudio.gui_add_item_to_combo_box("Decimal",false);
        ScanaStudio.gui_add_item_to_combo_box("HEX",true);
        ScanaStudio.gui_add_item_to_combo_box("Binary",false);
}


//Evaluate decoder GUI
function on_eval_gui_decoder()
{
    ScanaStudio.set_script_instance_name("1-Wire on CH " + (ScanaStudio.gui_get_value("ch") + 1).toString());
    return ""; //All good.
}


function reload_dec_gui_values()
{
    g_ch =  Number(ScanaStudio.gui_get_value("ch"));
    g_speed =  Number(ScanaStudio.gui_get_value("speed"));
    g_format =  Number(ScanaStudio.gui_get_value("format"));
    g_suffix = "";

    switch (g_format)
    {
        case 0:
          g_format = 10; //dec
          g_suffix = "";
          break;

        case 1:
          g_format = 16; //Hex
          g_suffix = "0x";
          break;

        case 2:
          g_format = 2; //bin
          g_suffix = "0b";
          break;

        default: break;
    }
}


function t2smpl(time)
{
    return g_sampling_rate * time;
}


function isASCII(str)
{
    is_ascii_char = false;

    if ((str >= 0x30) && (str <= 0x7E))
    {
        is_ascii_char = true;
    }

    ScanaStudio.console_info_msg(str + " is " + is_ascii_char);

    return is_ascii_char
}


// Helper function used to calculate the key parameters of 1-Wire waveforms
// this time are provided by the timing calculation Worksheet of Maxim Integrated
// https://www.maximintegrated.com/en/app-notes/index.mvp/id/126
// https://www.maximintegrated.com/en/tools/other/appnotes/126/AN126-timing-calculation.zip
function setup_1wire_parameters(spd)
{
	g_oWDelays = STANDARD_DELAYS;
}


function on_decode_signals_init()
{
	ScanaStudio.console_info_msg("on_decode_signals_init() : called");

    //initialization code
    reload_dec_gui_values();
    g_sampling_rate = ScanaStudio.get_capture_sample_rate();
    setup_1wire_parameters(g_speed);

    ScanaStudio.trs_reset(g_ch);    // Reset the trs iterator.
    trs = ScanaStudio.trs_get_next(g_ch);
    last_rising_edge = -1;
    last_falling_edge = -1;
    previous_edge = -1;
    bit_counter = 0;
    byte = 0;
    g_byte_sample_points = [];           // Clear array
	g_owObjects = [];
	g_pktObjects = [];
	g_next_trs = null;

    g_state = STATE.INIT;

	PKT_COLOR_DATA          = ScanaStudio.get_channel_color(g_ch);
	PKT_COLOR_DATA_TITLE    = "#808080";
	PKT_COLOR_RESET_TITLE   = "#008000";
	PKT_COLOR_PRES_TITLE    = "#EE82EE";
	PKT_COLOR_ROMCMD_TITLE  = "#FFA500";
	PKT_COLOR_ROMCODE_TITLE = "#0000FF";
	PKT_COLOR_UNKNW_TITLE   = "#000000";
	PKT_COLOR_OTHER_TITLE   = "#FFFF00";
	PKT_COLOR_INVALID       = "#FF0000";
}


function on_decode_signals_decode_bit_stream()
{
	ScanaStudio.console_info_msg("on_decode_signals_decode_bit_stream() : called");

	g_owObjects = [];

	var cur_trans = g_next_trs;
	var next_tr = ScanaStudio.trs_get_next(g_ch);

	while (ScanaStudio.trs_is_not_last(g_ch) == true)
	{
		ScanaStudio.console_info_msg("on_decode_signals_decode_bit_stream() : loop", next_tr.sample_index);
		if(ScanaStudio.abort_is_requested() == true)
		{
			return false;
		}

		// set_progress(100 * tr.sample / n_samples);   // Give feedback to ScanaStudio about decoding progress

		next_tr = get_next_falling_edge(g_ch, next_tr);

		ScanaStudio.console_info_msg("on_decode_signals_decode_bit_stream() : get_next_falling_edge()", next_tr.sample_index);

		var trLowSt = next_tr;
		next_tr = get_next_rising_edge(g_ch, next_tr);
		var tLow = get_timediff_us(trLowSt, next_tr);

		ScanaStudio.console_info_msg("on_decode_signals_decode_bit_stream() : get_timediff_us() = " + tLow);

		/****************************
				    RESET
		 ****************************/
   		if (tLow >= g_oWDelays.RSTL_MIN)
		{
			ScanaStudio.console_info_msg("on_decode_signals_decode_bit_stream() : reset detected", next_tr.sample_index);

			g_owObjects.push(new OWObject(OWOBJECT_TYPE.RESET, true, trLowSt.sample_index, next_tr.sample_index, tLow, false));

			var trPDH = get_next_falling_edge(g_ch, next_tr);
			var tPDH = get_timediff_us(next_tr, trPDH);

			if (tPDH < g_oWDelays.LOW1_MIN)
			{
				do
				{
					next_tr = ScanaStudio.trs_get_next(g_ch);
					trPDH = get_next_falling_edge(g_ch, next_tr);
					tPDH = get_timediff_us(next_tr, trPDH);

				} while (tPDH < g_oWDelays.LOW1_MIN);
			}

			if ((tPDH <= g_oWDelays.PDH_MAX) && (tPDH >= g_oWDelays.PDH_MIN))
			{
				var trPDL = get_next_rising_edge(g_ch, trPDH);
				var tPDL = get_timediff_us(trPDH, trPDL);

				ScanaStudio.console_info_msg("on_decode_signals_decode_bit_stream() : presence pulse detected", trPDL.sample_index);
				g_owObjects.push(new OWObject(OWOBJECT_TYPE.PRESENCE, true, trPDH.sample_index, trPDL.sample_index, tPDL, false));
				next_tr = trPDL;
			}
			else
			{
				ScanaStudio.console_warning_msg("on_decode_signals_decode_bit_stream() : presence pulse missing", trPDL.sample_index);
				g_owObjects.push(new OWObject(OWOBJECT_TYPE.PRESENCE, false, next_tr.sample_index, next_tr.sample_index + get_num_samples_for_us(g_oWDelays.PDH_MAX), false));
				next_tr = trPDH;
			}
		}
		/****************************
		             BIT
		 ****************************/
		else if (tLow >= g_oWDelays.LOW1_MIN)
		{
			var trHighSt = next_tr;
			var trHighEnd = get_next_falling_edge(g_ch, trHighSt);
			var tHigh = get_timediff_us(trHighSt, trHighEnd);
			var bitErr = false;

			if(trHighEnd == false)
			{
				trHighEnd = trHighSt;
                trHighEnd.sample_index = trHighEnd.sample_index + get_num_samples_for_us(Math.round((g_oWDelays.SLOT_MAX+g_oWDelays.SLOT_MIN)/2));
			}

            var slotStart = trLowSt.sample_index;
            var slotEnd   = trHighEnd.sample_index;
			var bitValue;

			// Master Write 1 Slot
			if ((tLow <= g_oWDelays.LOW1_MAX) && (tLow >= g_oWDelays.LOW1_MIN))
			{
				ScanaStudio.console_info_msg("on_decode_signals_decode_bit_stream() : master write 1", trHighEnd.sample_index);
				bitValue = 1;
			}
			// Master Write 0 Slot
			else if ((tLow <= g_oWDelays.LOW0_MAX) && (tLow >= g_oWDelays.LOW0_MIN))
			{
				ScanaStudio.console_info_msg("on_decode_signals_decode_bit_stream() : master write 0", trHighEnd.sample_index);
				bitValue = 0;
			}
			//  Master Read 0 Slot
			else if ((tLow <= (g_oWDelays.LOWR_MAX + g_oWDelays.REL_MAX)) && (tLow >= g_oWDelays.LOWR_MIN))
			{
				ScanaStudio.console_info_msg("on_decode_signals_decode_bit_stream() : master read 0", trHighEnd.sample_index);
				bitValue = 0;
			}
			// Error. Unknown bit value
			else
			{
				ScanaStudio.console_warning_msg("on_decode_signals_decode_bit_stream() : invalid slot", trHighEnd.sample_index);
				bitValue = false;
				bitErr = true;
			}

			if (tHigh > (g_oWDelays.SLOT_MAX + g_oWDelays.RDV + g_oWDelays.REL_MAX))
			{
                slotEnd = trHighSt;
                ScanaStudio.console_warning_msg("on_decode_signals_decode_bit_stream() : tHigh := " + tHigh);
			}

            g_owObjects.push(new OWObject(OWOBJECT_TYPE.BIT, bitValue, slotStart, slotEnd, bitErr, false));

			next_tr = trHighEnd;
		}
		/****************************
		          ERROR
		 ****************************/
		else if (tLow < g_oWDelays.LOW1_MIN)
		{
			/*
			if (owObjects.length > 0)
			{
				var lastObj = owObjects.pop();		// Skip invalid (too short) pulse

				if (lastObj.type == OWOBJECT_TYPE.BIT)
				{
					lastObj.start = trLowSt.sample;
					tr = trs_get_next(ch);
					lastObj.end = tr.sample;
				}

				owObjects.push(lastObj);
			}
			*/
		}
		else
		{
			/* owObjects.push(new OWObject(OWOBJECT_TYPE.UNKNOWN, true, trLowSt.sample, tr.sample, tLow, false));
			*/
		}
	}

}


function display_byte(a)
{
    var N = a.length;
    var bit;
    var midSample;

    ScanaStudio.console_info_msg("display_byte() : array length := " + N);

	for (var i = 0; i < N; i++)
	{
        bit = a.pop();
        midSample = Math.round((bit.start + bit.end)/2);

        if (bit.value == 1)
        {
            ScanaStudio.dec_item_add_sample_point(midSample, "1");
            ScanaStudio.console_info_msg("display_byte() : sample point := " + midSample);
        }
        else if (bit.value == 0)
        {
            ScanaStudio.dec_item_add_sample_point(midSample, "0");
            ScanaStudio.console_info_msg("display_byte() : sample point := " + midSample);
        }

        if(bit.duration == true)
        {
            ScanaStudio.dec_item_add_sample_point(midSample, "X");
        }
    }

    return;
}


function decode_sequence_RESET()
{

}


function decode_sequence_PRESENCE()
{

}


function decode_sequence_ROM_COMMAND()
{

}


function decode_sequence_SHOW_ROM()
{

}


function decode_sequence_SEARCH_ROM()
{

}


function decode_sequence_DATA()
{

}


function on_decode_signals_decode_sequence()
{
	var owObject;
	var stop = false;
	var pktOk = true;
	var firstRun = true;

    switch (g_state)
    {
		case STATE.INIT:
			ScanaStudio.console_info_msg("on_decode_signals_decode_sequence(): STATE.INIT");

			/* Display all unknown (transitions and pulses with wrong timing) fields
			*/
			for (var i = 0; i < g_owObjects.length; i++)
			{
				if (g_owObjects[i].type == OWOBJECT_TYPE.UNKNOWN)
				{
					/*
					dec_item_new(g_ch, owObjects[i].start, owObjects[i].end);
					dec_item_add_content("UNKNOWN PULSE");
					dec_item_add_content("UNKNOWN");
					dec_item_add_content("UN");
					dec_item_add_post_text(" (" + owObjects[i].duration + " us)");
					*/
					ScanaStudio.console_info_msg("on_decode_signals_decode_sequence(): OWOBJECT_TYPE.UNKNOWN");
				}
			}

			g_state = STATE.RESET;

		break;

		case STATE.RESET:
			ScanaStudio.console_info_msg("on_decode_signals_decode_sequence(): STATE.RESET");

			owObject = g_owObjects.shift();

			if (owObject.type == OWOBJECT_TYPE.RESET)
			{
				var resetStatus = "";

				if (g_speed == SPEED.REGULAR)
				{
					if (+owObject.duration < g_oWDelays.RSTL_STD)
					{
						resetStatus += "WARN. TOO SHORT: ";
					}
				}


				ScanaStudio.dec_item_new(g_ch, owObject.start, owObject.end);
				ScanaStudio.dec_item_add_content("MASTER RESET PULSE (" + resetStatus + (Math.round(owObject.duration * 100) / 100) + " us)");
				ScanaStudio.dec_item_add_content("RESET PULSE");
				ScanaStudio.dec_item_add_content("RESET");
				ScanaStudio.dec_item_add_content("R");
                // ScanaStudio.dec_item_add_sample_point(Math.round((owObject.start + owObject.end)/2), "U");
                ScanaStudio.dec_item_end();

				ScanaStudio.console_info_msg("on_decode_signals_decode_sequence(): OWOBJECT_TYPE.RESET");

				if (!firstRun)
				{
					pkt_add_packet(pktOk);
				}

				pktOk = true;
				firstRun = false;

				g_pktObjects.push(new PktObject("RESET", PKT_COLOR_RESET_TITLE, (resetStatus + (Math.round(owObject.duration * 100) / 100) + " us"), 0, 0, PKT_COLOR_DATA, owObject.start, owObject.end));

				g_state = STATE.PRESENCE;
			}

		break;

		case STATE.PRESENCE:
			ScanaStudio.console_info_msg("on_decode_signals_decode_sequence(): STATE.PRESENCE");

			owObject = g_owObjects.shift();

			if (owObject.type == OWOBJECT_TYPE.PRESENCE)
			{
				if (owObject.value == true)
				{

					ScanaStudio.dec_item_new(g_ch, owObject.start, owObject.end);
                    ScanaStudio.dec_item_emphasize_success();
					ScanaStudio.dec_item_add_content("SLAVE PRESENCE (" + (Math.round(owObject.duration * 100) / 100) + " us)");
					ScanaStudio.dec_item_add_content("PRESENCE");
					ScanaStudio.dec_item_add_content("PRES");
					ScanaStudio.dec_item_add_content("P");
                    ScanaStudio.dec_item_end();

					ScanaStudio.console_info_msg("on_decode_signals_decode_sequence(): OWOBJECT_TYPE.PRESENCE");

					g_pktObjects.push(new PktObject("PRESENCE", PKT_COLOR_PRES_TITLE, ((Math.round(owObject.duration * 100) / 100) + " us"), 0, 0, PKT_COLOR_DATA, owObject.start, owObject.end));
				}
				else
				{
					ScanaStudio.dec_item_new(g_ch, owObject.start, owObject.end);
                    ScanaStudio.dec_item_emphasize_warning();
                    ScanaStudio.dec_item_add_content("SLAVE PRESENCE MISSING");
					ScanaStudio.dec_item_add_content("PRESENCE MISSING");
					ScanaStudio.dec_item_add_content("MISSING");
					ScanaStudio.dec_item_add_content("M");
                    ScanaStudio.dec_item_end();

					ScanaStudio.console_warning_msg("on_decode_signals_decode_sequence(): OWOBJECT_TYPE.PRESENCE missing");

					g_pktObjects.push(new PktObject("PRESENCE", PKT_COLOR_INVALID, "PRESENCE MISSING", 0, 0, PKT_COLOR_DATA, owObject.start, owObject.end));
					pktOk = false;
				}

                if (g_owObjects.length > 0) {
                    owObject = g_owObjects.shift();
                    g_owObjects.unshift(owObject);

                    if (owObject.type == OWOBJECT_TYPE.RESET)
                    {
                        g_state = STATE.RESET;
                    }
                    else
                    {
                        g_state = STATE.ROM_COMMAND;
                    }
                }
                else
                {
                    g_state = STATE.RESET;
                }
			}
			else
			{
				g_state = STATE.RESET;
			}

		break;

		case STATE.ROM_COMMAND:
			ScanaStudio.console_info_msg("on_decode_signals_decode_sequence(): STATE.ROM_COMMAND");

			var romCmd = false;
			var romCmdStr;
			var owByte = get_ow_byte(g_ch); // g_byte_sample_points is updated

			if (owByte.isLast == true)
			{
				g_state = STATE.END;
				break;
			}

			ScanaStudio.dec_item_new(g_ch, owByte.start, owByte.end);
            display_byte(g_byte_sample_points);
            ScanaStudio.console_info_msg("on_decode_signals_decode_sequence(): ROM CMD := 0x" + int_to_str_hex(owByte.value));

            /*
			if ((uiHexView != HEXVIEW_OPT.DATA) && (uiHexView != HEXVIEW_OPT.ADR))
			{
				hex_add_byte(g_ch, -1, -1, owByte.value);
			}
			*/

			for (var k in ROM_CMD)
			{
				var cmd = ROM_CMD[k];

				if (owByte.value == cmd.code)
				{
					ScanaStudio.dec_item_add_content(cmd.str);
					ScanaStudio.dec_item_add_content("0x" + int_to_str_hex(owByte.value));

					ScanaStudio.console_info_msg("on_decode_signals_decode_sequence(): ROM CMD := " + cmd.str);

					g_pktObjects.push(new PktObject("ROM CMD", PKT_COLOR_ROMCMD_TITLE, cmd.str, 0, 0, PKT_COLOR_DATA, owByte.start, owByte.end));

					switch (cmd)
					{
						case ROM_CMD.READ_ROM:
						case ROM_CMD.MATCH_ROM: g_state = STATE.SHOW_ROM;
						break;

						case ROM_CMD.SEARCH_ROM: g_state = STATE.SEARCH_ROM;
						break;

						default: g_state = STATE.DATA;
						break;
					}
				}
			}

            ScanaStudio.dec_item_end();

		break;

		case STATE.SHOW_ROM:
			ScanaStudio.console_info_msg("on_decode_signals_decode_sequence(): STATE.SHOW_ROM");

			/* 64-bit ROM code:
			   [LSB] 8-bit Family Code | 48-bit Serial Number | 8-bit CRC | [MSB]
			*/
			var owByte;
			var romCode = [];
			var pktFamilyCode = "", pktSerialStr = "", pktCrcStr = "";

			do
			{
				owByte = get_ow_byte(g_ch);
				romCode.push(owByte);
			}
			while ((owByte.isLast != true) && (romCode.length < 8))

			if (romCode.length == 8)
			{
				// Calc CRC
				var calcCrc = get_crc8(romCode);

				// Show Family Code
				var familyCode = romCode.shift();
				/*
				dec_item_new(g_ch, familyCode.start, familyCode.end);

				if ((uiHexView != HEXVIEW_OPT.DATA) && (uiHexView != HEXVIEW_OPT.ROM))
				{
					hex_add_byte(g_ch, -1, -1, familyCode.value);
				}
				*/

				for (var k in DEVICE_FAMILY)
				{
					var device = DEVICE_FAMILY[k];

					if (familyCode.value == device.code)
					{
						pktFamilyCode = device.str;

						/*
						dec_item_add_content(device.str + " (");
						dec_item_add_post_text(")");
						*/
					}
				}

				/*
				dec_item_add_data(familyCode.value);
				*/

				var pktFamilyCodeStr;

				if (pktFamilyCode != "")
				{
					pktFamilyCodeStr = pktFamilyCode + " (" + int_to_str_hex(familyCode.value) + ")";
				}
				else
				{
					pktFamilyCodeStr = int_to_str_hex(familyCode.value);
				}

				// Show Serial Number
				for (var i = 0; i < romCode.length - 1; i++)
				{
					var data = romCode[i];
					/*
					dec_item_new(g_ch, data.start, data.end);
					dec_item_add_data(data.value);
					*/

					pktSerialStr += int_to_str_hex(data.value) + " ";

					/*
					if ((uiHexView != HEXVIEW_OPT.DATA) && (uiHexView != HEXVIEW_OPT.ROM))
					{
						hex_add_byte(g_ch, -1, -1, data.value);
					}
					*/
				}

				// Verify and show CRC
				var crcOk = true;

				deviceCrc = romCode[romCode.length - 1];

				/*
				dec_item_new(g_ch, deviceCrc.start, deviceCrc.end);
				dec_item_add_content("CRC: ");
				dec_item_add_data(deviceCrc.value);
				*/

				pktCrcStr = int_to_str_hex(deviceCrc.value);

				/*
				if ((uiHexView != HEXVIEW_OPT.DATA) && (uiHexView != HEXVIEW_OPT.ROM))
				{
					hex_add_byte(g_ch, -1, -1, deviceCrc.value);
				}
				*/

				if (deviceCrc.value == calcCrc)
				{
					pktCrcStr += " (OK)";
					/*
					dec_item_add_post_text(" OK");
					*/
				}
				else
				{
					pktCrcStr += " (WRONG)";
					/*
					dec_item_add_post_text(" WRONG");
					*/
					crcOk = false;
					pktOk = false;
				}

				g_pktObjects.push(new PktObject("FAMILY", PKT_COLOR_ROMCODE_TITLE, pktFamilyCodeStr, 0, 0, PKT_COLOR_DATA, familyCode.start, familyCode.end));
				g_pktObjects.push(new PktObject("SERIAL", PKT_COLOR_ROMCODE_TITLE, pktSerialStr, 0, 0, PKT_COLOR_DATA, romCode[0].start, romCode[romCode.length - 2].end));

				if (crcOk)
				{
					g_pktObjects.push(new PktObject("CRC", PKT_COLOR_ROMCODE_TITLE, pktCrcStr, 0, 0, PKT_COLOR_DATA, deviceCrc.start, deviceCrc.end));
				}
				else
				{
					g_pktObjects.push(new PktObject("CRC", PKT_COLOR_ROMCODE_TITLE, pktCrcStr, 0, 0, PKT_COLOR_INVALID, deviceCrc.start, deviceCrc.end));
				}
			}
			else if (romCode.length < 8)
			{
				var errStr = "INCOMPLETE";

				/*
				dec_item_new(g_ch, romCode[0].start, romCode[romCode.length - 1].end);
				dec_item_add_content(errStr);
				*/

				g_pktObjects.push(new PktObject("ROM CODE", PKT_COLOR_ROMCODE_TITLE, errStr, 0, 0, PKT_COLOR_DATA, romCode[0].start, romCode[romCode.length - 1].end));
			}

			g_state = STATE.DATA;

		break;

		case STATE.SEARCH_ROM:
			ScanaStudio.console_info_msg("on_decode_signals_decode_sequence(): STATE.SEARCH_ROM");

			var owByte;
			var owByteCnt = 0;
			var firstByte = get_ow_byte(g_ch);  // FIXME: g_byte_sample_points is updated!
			var lastByte;

			do
			{
				owByte = get_ow_byte(g_ch);     // FIXME: g_byte_sample_points is updated!
				owByteCnt++;

				if (owByte.isLast != true)
				{
					lastByte = owByte;
				}

			} while (owByte.isLast != true);

			/*
			dec_item_new(g_ch, firstByte.start, lastByte.end);
			dec_item_add_content("SEARCH ROM SEQUENCE");
			*/

			g_pktObjects.push(new PktObject("SRCH SEQ", PKT_COLOR_OTHER_TITLE, ((owByteCnt * 8) + " bits"), 0, 0, PKT_COLOR_DATA, firstByte.start, lastByte.end));

			g_state = STATE.RESET;

		break;

		case STATE.DATA:
			ScanaStudio.console_info_msg("on_decode_signals_decode_sequence(): STATE.DATA");

			/* Get and show all data */

			owObject = g_owObjects.shift();
			g_owObjects.unshift(owObject);

			if (owObject.type == OWOBJECT_TYPE.RESET)
			{
				g_state = STATE.RESET;
				break;
			}

			var owByte;
			var pktObj = new PktObject();

			pktObj.title = "DATA";
			pktObj.data = "";
			pktObj.titleColor = PKT_COLOR_DATA_TITLE;
			pktObj.dataColor = PKT_COLOR_DATA;
			pktObj.dataObjArr = [];
			pktObj.start = false;
			pktObj.dataLen = 0;

			do
			{
				owByte = get_ow_byte(g_ch); // FIXME: g_byte_sample_points is updated!

				if (owByte.isLast != true)
				{
					var dataStr = int_to_str_hex(owByte.value);
                    ScanaStudio.dec_item_new(g_ch, owByte.start, owByte.end);
                    display_byte(g_byte_sample_points);
					// ScanaStudio.dec_item_add_content(String.fromCharCode(owByte.value) +" (0x" + dataStr + ")");
                    if (isASCII(owByte.value) == true)
                    {
                        ScanaStudio.dec_item_add_content(String.fromCharCode(owByte.value));
                    }
                    ScanaStudio.dec_item_add_content("0x" + dataStr);
                    ScanaStudio.dec_item_end();

					/*
					if ((uiHexView != HEXVIEW_OPT.ROM) && (uiHexView != HEXVIEW_OPT.ADR))
					{
						hex_add_byte(g_ch, -1, -1, owByte.value);
					}
					*/

					pktObj.data +=  dataStr + " ";
					owByte.value = dataStr;
					pktObj.dataObjArr.push(owByte);
					pktObj.dataLen++;

					if (!pktObj.start)
					{
						pktObj.start = owByte.start;
					}

					pktObj.end = owByte.end;
				}

				if (owByte.duration == true)
				{
					ScanaStudio.dec_item_new(g_ch, owByte.start, owByte.end);
                    display_byte(g_byte_sample_points);
					ScanaStudio.dec_item_add_content("INVALID BYTE");
                    ScanaStudio.dec_item_end();

					pktObj.data += "XXXX ";
					owByte.value = "XXXX";
					pktObj.dataObjArr.push(owByte);
					pktObj.dataLen++;

					pktObj.dataColor = PKT_COLOR_INVALID;
					pktOk = false;
				}

			} while (owByte.isLast != true);

			if (pktObj.dataLen > 0)
			{
				g_pktObjects.push(pktObj);
			}

			g_state = STATE.RESET;

		break;

		case STATE.END:
			ScanaStudio.console_info_msg("on_decode_signals_decode_sequence(): STATE.END");

			g_state = STATE.RESET;

		break;
	}

    pkt_add_packet(pktOk);
}


function on_decode_signals(resume)
{
    if (!resume) //If resume == false, it's the first call to this function.
    {
    	on_decode_signals_init();
    }

    while ( (ScanaStudio.abort_is_requested() == false) && (ScanaStudio.trs_is_not_last(g_ch) == true) )
    {
    	on_decode_signals_decode_bit_stream();

        var tmp_trs_sample_index;
        tmp_trs_sample_index = trs.sample_index;
        while( (tmp_trs_sample_index == trs.sample_index) && (ScanaStudio.trs_is_not_last(g_ch) == true) )
        {
            TRANS = ScanaStudio.trs_get_next(g_ch);
        }
    }//end while

	while (g_owObjects.length > 0)
	{
		on_decode_signals_decode_sequence();
		// g_owObjects.pop();
	}

    return;
}


/*
*************************************************************************************
							        UTILS
*************************************************************************************
*/

/*
*/
function pkt_add_packet (ok)
{
	var obj;
	var desc = "";
	var objCnt = 0;
	var pktDataPerLine = 7;

	if (g_pktObjects.length < 1)
	{
		return;
	}

	for (var i = 0; i < g_pktObjects.length; i++)
	{
		obj = g_pktObjects[i];

		if (obj.title.localeCompare("ROM CMD") == 0)
		{
			desc += obj.data.replace("ROM", "");
		}

		if (obj.title.localeCompare("FAMILY") == 0)
		{
			var substr = obj.data.substring(obj.data.lastIndexOf("(") + 1, obj.data.lastIndexOf(")"));
			desc += substr + " ";
		}

		if (obj.title.localeCompare("DATA") == 0)
		{
			desc += " DATA[" + obj.dataObjArr.length + "]";
		}
	}

	desc = desc.replace(/  +/g, ' ');

	var pktStart = g_pktObjects[0].start;
	var pktEnd = g_pktObjects[g_pktObjects.length - 1].end;

	// pkt_start("1-WIRE");

	if (ok)
	{
		ScanaStudio.packet_view_add_packet(true, g_ch, pktStart, pktEnd, "1-WIRE FRAME", desc, PKT_COLOR_DATA_TITLE, PKT_COLOR_DATA);
	}
	else
	{
		ScanaStudio.packet_view_add_packet(true, g_ch, pktStart, pktEnd, "1-WIRE FRAME", desc, PKT_COLOR_INVALID, PKT_COLOR_DATA);
	}

	// pkt_start("NEW FRAME");

	while (g_pktObjects.length > objCnt)
	{
		obj = g_pktObjects[objCnt];
		objCnt++;

		if (obj.title.localeCompare("DATA") == 0)
		{
			if (obj.dataLen > pktDataPerLine)
			{
				var dataLine = "";
				var lineStart = false, lineEnd;
				var dataCnt = 0, lineCnt = 0;

				while (obj.dataObjArr.length > dataCnt)
				{
					if (lineCnt <= pktDataPerLine)
					{
						if (!lineStart)
						{
							lineStart = obj.dataObjArr[dataCnt].start;
						}

						lineEnd = obj.dataObjArr[dataCnt].end;
						dataLine = dataLine + obj.dataObjArr[dataCnt].value + " ";
						lineCnt++;
						dataCnt++;
					}
					else
					{
						ScanaStudio.packet_view_add_packet(false, g_ch, lineStart, lineEnd, obj.title, dataLine, obj.titleColor, obj.dataColor);
						lineStart = false;
						dataLine = "";
						lineCnt = 0;
					}
				}

				if (lineCnt > 0)
				{
					ScanaStudio.packet_view_add_packet(false, g_ch, lineStart, lineEnd, obj.title, dataLine, obj.titleColor, obj.dataColor);
				}
			}
			else
			{
				ScanaStudio.packet_view_add_packet(false, g_ch, obj.start, obj.end, obj.title, obj.data, obj.titleColor, obj.dataColor);
			}
		}
		else
		{
			if (obj.title.localeCompare("RESET") != 0)
			{
				if ((obj.title.localeCompare("PRESENCE")) != 0 || (obj.data.localeCompare("PRESENCE MISSING") == 0))
				{
					ScanaStudio.packet_view_add_packet(false, g_ch, obj.start, obj.end, obj.title, obj.data, obj.titleColor, obj.dataColor);
				}
			}
		}
	}

	g_pktObjects.length = 0;
	g_pktObjects = [];
}


/*
*/
function int_to_str_hex (num)
{
	var temp = "";

	if (num < 0x10)
	{
		temp += "0";
	}

	temp += num.toString(16).toUpperCase();

	return temp;
}



/* Get a byte from 1-Wire bus
*/
function get_ow_byte (ch)
{
	var byteStart = false, byteEnd = false;
	var byteValue = false;
	var byteErr = false;
	var isLast = false;
	var i = 0;

    while (g_byte_sample_points.length > 0) { g_byte_sample_points.pop(); }

	if (g_owObjects.length > 0)
	{
		do
		{
			if (g_owObjects.length == 0) {
                ScanaStudio.console_warning_msg("get_ow_byte() : too few bits extracted " + i);
                break;
            }

			owObject = g_owObjects.shift();

			if (owObject.type != OWOBJECT_TYPE.BIT)
			{
				g_owObjects.unshift(owObject);
				isLast = true;
                ScanaStudio.console_warning_msg("get_ow_byte() : got new object of type " + owObject.type.toString());
				break;
			}
            else
            {
                ScanaStudio.console_info_msg("get_ow_byte() : got new bit := " + owObject.value.toString());
            }

			byteValue >>= 1;

			if (owObject.value == 1)
			{
				byteValue |= 0x80;
			}

			/* Show each bit value */
			var midSample = ((owObject.start + owObject.end) / 2);

            g_byte_sample_points.push(owObject);
            ScanaStudio.console_info_msg("get_ow_byte() : byte length := " + g_byte_sample_points.length);

			if(owObject.duration == true)
			{
				byteErr = true;
			}

			if (byteStart == false)
			{
				byteStart = owObject.start;
			}

			byteEnd = owObject.end;
			i++;
		}
		while ((i < 8) && (owObject.type == OWOBJECT_TYPE.BIT));
	}
	else
	{
		isLast = true;
	}

	if (i < 7)
	{
		if (byteStart != false && byteEnd != false)
		{
			byteErr = true;
		}
	}

	return new OWObject(OWOBJECT_TYPE.BYTE, byteValue, byteStart, byteEnd, byteErr, isLast);
}


/*
*/
function us_to_s (us)
{
	return (us * 1e-6);
}

/* Get time difference in microseconds between two transitions
*/
function get_timediff_us (tr1, tr2)
{
	return (((tr2.sample_index - tr1.sample_index) * 1000000) / ScanaStudio.get_capture_sample_rate());
}

/*  Get number of samples for the specified duration in microseconds
*/
function get_num_samples_for_us (us)
{
	return ((us * ScanaStudio.get_capture_sample_rate()) / 1000000);
}

/*  CRC8 algorithm for one byte
*/
function compute_crc8 (data, seed)
{
    var temp;

    for (var i = 8; i > 0; i--)
    {
        temp = ((seed ^ data) & 0x01);

        if(temp == 0)
        {
            seed >>= 1;
        }
        else
        {
            seed ^= 0x18;
            seed >>= 1;
            seed |= 0x80;
        }
        data >>= 1;
    }

    return seed;
}

/*	Get 8-byte crc
*/
function get_crc8 (romCode)
{
	var crc;

	for (var i = 0; i < 7; i++)
	{
		crc = compute_crc8(romCode[i].value, crc);
	}

	return crc;
}

function get_crc8_from_array (a)
{
	var crc;

	for (var i = 0; i < 7; i++)
	{
		crc = compute_crc8(a[i], crc);
	}

	return crc;
}

/* Get next transition with falling edge
*/
function get_next_falling_edge (ch, trStart)
{
	var tr = trStart;

	// ScanaStudio.console_info_msg("get_next_falling_edge() : begin", tr.sample_index);

	while ((tr.value != 0) && (ScanaStudio.trs_is_not_last(ch) == true))
	{
		tr = ScanaStudio.trs_get_next(ch);	// Get the next transition

		// ScanaStudio.console_info_msg("get_next_falling_edge() : loop sample index := " + tr.sample_index);
	}

	// ScanaStudio.console_info_msg("get_next_falling_edge() : end", tr.sample_index);

	if (ScanaStudio.trs_is_not_last(ch) == false) tr = false;

	return tr;
}

/*	Get next transition with rising edge
*/
function get_next_rising_edge (ch, trStart)
{
	var tr = trStart;

	// ScanaStudio.console_info_msg("get_next_rising_edge() : begin", tr.sample_index);

	while ((tr.value != 1) && (ScanaStudio.trs_is_not_last(ch) == true))
	{
		tr = ScanaStudio.trs_get_next(ch);	// Get the next transition

		// ScanaStudio.console_info_msg("get_next_rising_edge() : loop sample index := " + tr.sample_index);
	}

	// ScanaStudio.console_info_msg("get_next_rising_edge() : end", tr.sample_index);

	if (ScanaStudio.trs_is_not_last(ch) == false) tr = false;

	return tr;
}


//Function called to generate demo siganls (when no physical device is attached)
function on_build_demo_signals()
{
    //Use the function below to get the number of samples to be built
    var samples_to_build = ScanaStudio.builder_get_maximum_samples_count();
    var builder = ScanaStudio.BuilderObject;
    reload_dec_gui_values();

    setup_1wire_parameters(g_speed);

    builder.config(g_ch, g_speed, ScanaStudio.builder_get_sample_rate());

    builder.put_silence(10e-3);

    while (ScanaStudio.builder_get_samples_acc(g_ch) < samples_to_build)
    {
        builder.put_reset_rng();
        builder.put_presence_rng(Math.floor(Math.random()*2));

        var random_size = Math.floor(Math.random() * 10) + 1;
        var w;

        for (w = 0; w < random_size; w++)
        {
            random_data = Math.round(Math.random() * 256);
            builder.put_byte_rng(random_data);
        }
        builder.put_silence(10e-3);
    }
}


var trig_alt;
//Trigger sequence GUI
function on_draw_gui_trigger()
{
    ScanaStudio.gui_add_new_selectable_containers_group("trig_alt","Select trigger type");
        ScanaStudio.gui_add_new_container("Trigger on any valid frame",true);
            ScanaStudio.gui_add_info_label("Trigger on any 1-Wire Frame. In other words,"+
            "this alternative will trigger on Master reset pulse.");
            ScanaStudio.gui_add_check_box("trig_chk_presence", "Only frame with presence bit answwered by slaves", true);
        ScanaStudio.gui_end_container();
        ScanaStudio.gui_add_new_container("Trigger on specific word",false);
            ScanaStudio.gui_add_info_label("Type decimal value (65), Hex value (0x41) or ASCII character ('A')");
            ScanaStudio.gui_add_text_input("trig_byte","Trigger word","");
        ScanaStudio.gui_end_container();
        // ScanaStudio.gui_add_new_container("Trigger on a characters string",false);
        //     ScanaStudio.gui_add_info_label("Type a character string to be used for trigger. E.g.: Hello World");
        //     ScanaStudio.gui_add_text_input("trig_phrase","Trigger phrase","");
        // ScanaStudio.gui_end_container();
    ScanaStudio.gui_end_selectable_containers_group();
}

//Evaluate trigger GUI
function on_eval_gui_trigger()
{
    trig_chk_presence = ScanaStudio.gui_get_value("trig_chk_presence");
    trig_alt = ScanaStudio.gui_get_value("trig_alt");
    trig_byte = ScanaStudio.gui_get_value("trig_byte");
    // trig_phrase = ScanaStudio.gui_get_value("trig_phrase");

    if (trig_alt == 1)
    {
        if (trig_byte.length == 0)
        {
            return "Please specify trigger byte";
        }
        else if (isNaN(trig_byte))
        {
            if ((trig_byte.charAt(0) == "'") && (trig_byte.length < 3))
            {
                return "Invalid character";
            }
            if (trig_byte.length > 3)
            {
                return "Invalid trigger byte: Please enter only one character, e.g. 'a'";
            }
        }
    }
    else if (trig_alt == 2)
    {
        var total_size = 0;
        for (c = 0; c < trig_phrase.length; c++)
        {
            total_size += build_octet(trig_phrase.charCodeAt(c));
        }

        if (total_size > 63)
        {
            return "Trigger phrase too large, please use less characters.";
        }
    }
    return ""; //All good.
}

function on_build_trigger()
{
    trig_chk_presence = ScanaStudio.gui_get_value("trig_chk_presence");
    trig_alt = ScanaStudio.gui_get_value("trig_alt");
    trig_byte = ScanaStudio.gui_get_value("trig_byte");
    // trig_phrase = ScanaStudio.gui_get_value("trig_phrase");

    reload_dec_gui_values();

    setup_1wire_parameters(g_speed);

    if (trig_alt == 0) //Trig on any byte
    {
        build_master_reset_pulse_step(trig_chk_presence);
    }
    else if(trig_alt == 1) //Trig on one byte
    {
        build_octet(trig_byte);
    }
    else //trig on phrase
    {
        var total_size = 0;
        for (c = 0; c < trig_phrase.length; c++)
        {
            total_size += build_octet(trig_phrase.charCodeAt(c));
        }

        if (total_size > 63)
        {
            ScanaStudio.console_error_msg("Trigger phrase too large, please use less characters.");
        }
    }

    // ScanaStudio.flexitrig_print_steps();
}


function build_master_reset_pulse_step(presence)
{
    var step = "";
    var return_nbr_step = 0;

    for (var i = 0; i < ScanaStudio.get_device_channels_count(); i++)
    {
        if (i == g_ch)
        {
            step = "F" + step;
        }
        else
        {
            step = "X" + step;
        }
    }
    ScanaStudio.flexitrig_append(step,-1, -1);
    return_nbr_step++;

    step = "";
    for (var i = 0; i < ScanaStudio.get_device_channels_count(); i++)
    {
        if (i == g_ch)
        {
            step = "R" + step;
        }
        else
        {
            step = "X" + step;
        }
    }

    ScanaStudio.flexitrig_append(step, t_H_min, t_H_max);
    return_nbr_step++;

    if(presence)
    {
        step = "";
        for (var i = 0; i < ScanaStudio.get_device_channels_count(); i++)
        {
            if (i == g_ch)
            {
                step = "F" + step;
            }
            else
            {
                step = "X" + step;
            }
        }

        ScanaStudio.flexitrig_append(step, -1, t_I_max);
        return_nbr_step++;

        step = "";
        for (var i = 0; i < ScanaStudio.get_device_channels_count(); i++)
        {
            if (i == g_ch)
            {
                step = "R" + step;
            }
            else
            {
                step = "X" + step;
            }
        }

        ScanaStudio.flexitrig_append(step, -1, t_J_type);
        return_nbr_step++;
    }

    return return_nbr_step;
}


function build_bit(bit)
{
    var step = "";
    var return_nbr_step = 0;

    for (var i = 0; i < ScanaStudio.get_device_channels_count(); i++)
    {
        if (i == g_ch)
        {
            step = "F" + step;
        }
        else
        {
            step = "X" + step;
        }
    }
    ScanaStudio.flexitrig_append(step,-1, -1);
    return_nbr_step++;

    step = "";
    for (var i = 0; i < ScanaStudio.get_device_channels_count(); i++)
    {
        if (i == g_ch)
        {
            step = "R" + step;
        }
        else
        {
            step = "X" + step;
        }
    }

    if(bit==1)
    {
        ScanaStudio.flexitrig_append(step, t_A_min, t_A_max);
    }
    else
    {
        ScanaStudio.flexitrig_append(step, t_C_min,  t_C_max);
    }
    return_nbr_step++;

    return return_nbr_step;
}


function build_octet(octet)
{
    var return_nbr_step = 0;

    for(var i=0; i<8; i++)
    {
        return_nbr_step += build_bit((octet>>(7-i))&0x1);
    }

    return return_nbr_step;
}


//Builder object that can be shared to other scripts
ScanaStudio.BuilderObject =
{
    ch: 0,
    speed: 0,
    sampling_rate: 0,

    config : function(channel, spd, sampl_rate)
    {
        this.ch = channel;
        this.speed = spd;
        this.sampling_rate = sampl_rate;
        setup_1wire_parameters(this.speed);
    },

    put_reset : function()
    {
        ScanaStudio.builder_add_samples(this.ch, 1, this.sampling_rate * t_G_type);
        ScanaStudio.builder_add_samples(this.ch, 0, this.sampling_rate * t_H_type);
        ScanaStudio.builder_add_samples(this.ch, 1, 1);
    },

    put_presence : function(presence_bit)
    {
        ScanaStudio.builder_add_samples(this.ch, 1, this.sampling_rate * 0.5 * t_I_type);
        ScanaStudio.builder_add_samples(this.ch, presence_bit, this.sampling_rate * 0.5 * (t_J_type + t_I_type) );
        ScanaStudio.builder_add_samples(this.ch, 1, this.sampling_rate * 0.5 * t_J_type );
    },

    put_silence : function(time)
    {
        ScanaStudio.builder_add_samples(this.ch, 1, this.sampling_rate * time);
    },

    put_bit : function(b)
    {
        if(b == 0)
        {
            ScanaStudio.builder_add_samples(this.ch, 0, this.sampling_rate * t_C_type);
            ScanaStudio.builder_add_samples(this.ch, 1, this.sampling_rate * t_D_type);
        }
        else
        {
            ScanaStudio.builder_add_samples(this.ch, 0, this.sampling_rate * t_A_type);
            ScanaStudio.builder_add_samples(this.ch, 1, this.sampling_rate * t_B_type);
        }
    },

    put_byte : function(byte)
    {
        var b = 0;

        for (b = 0; b < 8; b++)
        {
            this.put_bit((byte >> b) & 0x1);
        }
    },

    put_reset_rng : function()
    {
        var rng;
        rng = t_G_min + (Math.random() * (t_G_type - t_G_min));
        ScanaStudio.builder_add_samples(this.ch, 1, this.sampling_rate * rng);
        rng = t_H_min + (Math.random() * (t_H_max - t_H_min));
        ScanaStudio.builder_add_samples(this.ch, 0, this.sampling_rate * rng);
        ScanaStudio.builder_add_samples(this.ch, 1, 1);
    },

    put_presence_rng : function(presence_bit)
    {
        var rng_i;
        var rng_j;
        rng_i = t_I_min + (Math.random() * (t_I_max - t_I_min));
        rng_j = t_J_min + (Math.random() * (t_J_type - t_J_min));
        ScanaStudio.builder_add_samples(this.ch, 1, this.sampling_rate * 0.5 * rng_i);
        ScanaStudio.builder_add_samples(this.ch, presence_bit, this.sampling_rate * 0.5 * (rng_j + rng_i) );
        ScanaStudio.builder_add_samples(this.ch, 1, this.sampling_rate * 0.5 * rng_j );
    },

    put_bit_rng : function(b)
    {
        var rng;
        if(b == 0)
        {
            rng = t_C_min + (Math.random() * (t_C_max - t_C_min));
            ScanaStudio.builder_add_samples(this.ch, 0, this.sampling_rate * rng);
            rng = t_D_min + (Math.random() * (t_D_type - t_D_min));
            ScanaStudio.builder_add_samples(this.ch, 1, this.sampling_rate * rng);
        }
        else
        {
            rng = t_A_min + (Math.random() * (t_A_max - t_A_min));
            ScanaStudio.builder_add_samples(this.ch, 0, this.sampling_rate * rng);
            rng = t_B_min + (Math.random() * (t_B_type - t_B_min));
            ScanaStudio.builder_add_samples(this.ch, 1, this.sampling_rate * rng);
        }
    },

    put_byte_rng : function(byte)
    {
        var b = 0;

        for (b = 0; b < 8; b++)
        {
            this.put_bit_rng((byte >> b) & 0x1);
        }
    }
};
