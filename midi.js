/* Protocol meta info:
<NAME> MIDI </NAME>
<DESCRIPTION>
MIDI 1.0 protocol
</DESCRIPTION>
<VERSION> 0.5 </VERSION>
<AUTHOR_NAME>  Ibrahim KAMAL </AUTHOR_NAME>
<AUTHOR_URL> i.kamal@ikalogic.com </AUTHOR_URL>
<HELP_URL> https://github.com/ikalogic/ScanaStudio-scripts-v3/wiki </HELP_URL>
<COPYRIGHT> Copyright IKALOGIC </COPYRIGHT>
<LICENSE>  This code is distributed under the terms of the GNU General Public License GPLv3 </LICENSE>
<RELEASE_NOTES>
V0.5: Added packet view
V0.2: Added dec_item_end() for each dec_item_new()
V0.1: Initial release
</RELEASE_NOTES>
*/

//Thanks to https://www.midi.org/specifications-old/item/table-1-summary-of-midi-message

/*
TODO:
* Display format options
* Document

Future release (Volunteers welcome!)
* Create MIDI file from captured data (to be able to play it on PC)
* Build signals from midi file (to be able to generate MIDI signals with SQ device)
*/

//Decoder GUI
function on_draw_gui_decoder()
{
    ScanaStudio.gui_add_ch_selector("ch","Midi channel","MIDI");
    ScanaStudio.gui_add_new_tab("Advanced options",false);
    ScanaStudio.gui_add_baud_selector("baud","BAUD Rate",31250);
    ScanaStudio.gui_add_combo_box("invert","Idle level");
      ScanaStudio.gui_add_item_to_combo_box("Logic 1 (UART default)",true);
      ScanaStudio.gui_add_item_to_combo_box("Logic 0 (Inversed)",false);
    ScanaStudio.gui_end_tab();

    //Hiden items for UART decoder
    ScanaStudio.gui_add_hidden_field("format_hex",0);
    ScanaStudio.gui_add_hidden_field("format_ascii",0);
    ScanaStudio.gui_add_hidden_field("format_dec",0);
    ScanaStudio.gui_add_hidden_field("format_bin",0);
    ScanaStudio.gui_add_hidden_field("nbits",3);
    ScanaStudio.gui_add_hidden_field("parity",0);
    ScanaStudio.gui_add_hidden_field("stop",1);
    ScanaStudio.gui_add_hidden_field("order",0); //LSB first
}

//Evaluate decoder GUI
function on_eval_gui_decoder()
{
    reload_gui_values();
    ScanaStudio.set_script_instance_name("MIDI on CH " + ch.toString());
    return "" //All good.
}

function reload_gui_values()
{
    ch = ScanaStudio.gui_get_value("ch");
    baud = ScanaStudio.gui_get_value("baud");
    invert = ScanaStudio.gui_get_value("invert");
}

//Global variables
var sampling_rate;
var state_machine;
var ch;
var baud;
var invert;
var pkt_start = 0;
var midi_cmd;
var midi_status;
var pkt_data = [];

var MIDI_WAIT_STATUS = 0;
var MIDI_WAIT_DATA = 1;

function on_decode_signals(resume)
{
  if (!resume) //If resume == false, it's the first call to this function.
  {
      state_machine = MIDI_WAIT_STATUS;
      builder_midi_commands_db();
      reload_gui_values();
  }

  uart_items = ScanaStudio.pre_decode("uart.js",resume);

  for (var i = 0; i < uart_items.length; i++)
  {
    if (ScanaStudio.abort_is_requested()) break;

    switch (state_machine)
    {
      case MIDI_WAIT_STATUS:
        if (isNaN(uart_items[i].content))
        {
          break;
        }
        if (Number(uart_items[i].content) & 0x80) //found
        {
          midi_status = Number(uart_items[i].content);
          midi_cmd = get_midi_cmd(midi_status);
          build_midi_header_dec_item(midi_cmd, midi_status, uart_items[i].start_sample_index, uart_items[i].end_sample_index);

          pkt_data = [];
          if (midi_cmd.len != 0)
          {
            state_machine = MIDI_WAIT_DATA;
          }
        }
        break;

      case MIDI_WAIT_DATA:
        if (isNaN(uart_items[i].content))
        {
          break;
        }

        // ScanaStudio.console_info_msg("parsing data: " + uart_items[i].content,uart_items[i].start_sample_index);
        if (Number(uart_items[i].content) & 0x80) //Unexpted here!
        {
          state_machine = MIDI_WAIT_STATUS;
          // ScanaStudio.console_info_msg("Unexpted data: " + uart_items[i].content,uart_items[i].start_sample_index);
          i--;
        }
        else //accumulate the data
        {
          if (midi_cmd.len == -1)
          {
            ScanaStudio.dec_item_new(ch, uart_items[i].start_sample_index, uart_items[i].end_sample_index);
            ScanaStudio.dec_item_add_content(uart_items[i].content);
            ScanaStudio.dec_item_end();

            ScanaStudio.packet_view_add_packet(false, ch, uart_items[i].start_sample_index, uart_items[i].end_sample_index, "Data", uart_items[i].content, "#33FFFF", "#99FFFF");
          }
          else
          {
            if (pkt_data.length == 0)
            {
              pkt_start = uart_items[i].start_sample_index;
            }
            pkt_data.push(Number(uart_items[i].content));
            if (pkt_data.length >= midi_cmd.len)
            {
              build_midi_data_dec_items(midi_cmd, pkt_data, pkt_start, uart_items[i].end_sample_index);
              state_machine = MIDI_WAIT_STATUS;
            }
          }
        }
        break;
      default:
        state_machine = MIDI_WAIT_STATUS;
    }
  }

}

//Function called to generate demo siganls (when no physical device is attached)
function on_build_demo_signals()
{
  //Use the function below to get the number of samples to be built
  var samples_to_build = ScanaStudio.builder_get_maximum_samples_count();
  var silence_period_samples = 1000 + (samples_to_build / 125);
  var builder = ScanaStudio.BuilderObject;
  builder_midi_commands_db();
  reload_gui_values();
  builder.config(ch,baud,invert);

  builder.put_silence(silence_period_samples);

  var midi_db_counter = 0;
  var midi_channel = 0;
  while(ScanaStudio.builder_get_samples_acc(ch) < samples_to_build)
  {
    if (ScanaStudio.abort_is_requested())
    {
      break;
    }
    //put midi frame with random data
    var data = [];
    if (midi_cmd_db[midi_db_counter].len > 0)
    {
      data = new Array(midi_cmd_db[midi_db_counter].len);
    }
    else if (midi_cmd_db[midi_db_counter].len < 0) //Random data len
    {
      data = new Array(Math.floor(Math.random()*100) + 1); //from 1 to 100 bytes
    }

    //Fill the data
    for (var d=0; d < data.length; d++)
    {
      data[d] = Math.floor(Math.random()*127);
    }

    if (midi_cmd_db[midi_db_counter].status_mask == 0xF0)
    {
      midi_channel = Math.floor(Math.random()*15);
    }
    else
    {
      midi_channel = 0;
    }

    builder.put_midi(
                      midi_cmd_db[midi_db_counter].status | midi_channel,
                      data
                      );

    builder.put_silence(silence_period_samples);

    midi_db_counter++;
    if (midi_db_counter >= midi_cmd_db.length)
    {
      midi_db_counter = 0;
    }
  }
}

//Builder object that can be shared to other scripts
ScanaStudio.BuilderObject = {
  //to be configured by the user of this object using the setter functions below
  channel: 0,
  sampling_rate: 1e6,
  put_silence : function(samples)
  {
    this.builder.put_silence_samples(samples);
  },
	put_midi : function(status,data_array)
  {
    this.builder.put_c(status);
    for (var i = 0; i < data_array.length; i++)
    {
      this.builder.put_c(data_array[i]);
    }
  },
  config : function(ch,baud,invert)
  {
    this.builder = ScanaStudio.load_builder_object("uart.js");
    this.builder.config(
        ch,
        baud,
        (8-5), //GUI starts at 5 bits per frame.
        0, //parity
        1, //Stop bits
        0, //order
        invert,
        ScanaStudio.builder_get_sample_rate()
    );
  }
};


//Helper function & types
var midi_cmd_db = [];
var DATA_TYPE_NONE          = 0;
var DATA_TYPE_NOTE_VELOCITY = 1;
var DATA_TYPE_CTRLNUM_VALUE	= 2;
var DATA_TYPE_BYTE          = 3;
var DATA_TYPE_LSB_MSB       = 4;
var DATA_TYPE_SYSTEM_EX     = 5;
var DATA_TYPE_TIMECODE      = 6;
var DATA_TYPE_UNKNOWN       = 7;


function builder_midi_commands_db()
{
  //Channel Voice Messages
  midi_cmd_db.push(new midi_cmd_t(0x80,0xF0,"ON","Note ON",DATA_TYPE_NOTE_VELOCITY,2));
  midi_cmd_db.push(new midi_cmd_t(0x90,0xF0,"OFF","Note OFF",DATA_TYPE_NOTE_VELOCITY,2));
  midi_cmd_db.push(new midi_cmd_t(0xA0,0xF0,"AT","Aftertouch",DATA_TYPE_NOTE_VELOCITY,2));
  midi_cmd_db.push(new midi_cmd_t(0xB0,0xF0,"CC","Control Change",DATA_TYPE_CTRLNUM_VALUE,2));
  midi_cmd_db.push(new midi_cmd_t(0xC0,0xF0,"PC","Program Change",DATA_TYPE_BYTE,1));
  midi_cmd_db.push(new midi_cmd_t(0xD0,0xF0,"CP","Channel Pressure",DATA_TYPE_BYTE,1));
  midi_cmd_db.push(new midi_cmd_t(0xE0,0xF0,"PW","Pitch Wheel",DATA_TYPE_LSB_MSB,2));

  //System Common Messages
  midi_cmd_db.push(new midi_cmd_t(0xF0,0xFF,"Excl","System Exclusive",DATA_TYPE_SYSTEM_EX,-1));
  //Always keep the "End Exclusive" command right after the "System Exclusive" to ensure
  //the demo mode always generates those two frames consecutively.
  midi_cmd_db.push(new midi_cmd_t(0xF7,0xFF,"EE","End Exclusive",DATA_TYPE_NONE,0));
  midi_cmd_db.push(new midi_cmd_t(0xF1,0xFF,"Time","Time Code",DATA_TYPE_TIMECODE,1));
  midi_cmd_db.push(new midi_cmd_t(0xF2,0xFF,"Pos","Song Position",DATA_TYPE_LSB_MSB,2));
  midi_cmd_db.push(new midi_cmd_t(0xF3,0xFF,"Song","Song Select",DATA_TYPE_BYTE,1));
  midi_cmd_db.push(new midi_cmd_t(0xF6,0xFF,"Tune","Tune Request",DATA_TYPE_NONE,0));

  //System Real Time messages
  midi_cmd_db.push(new midi_cmd_t(0xF8,0xFF,"T","Timing Clock (Tempo)",DATA_TYPE_NONE,0));
  midi_cmd_db.push(new midi_cmd_t(0xFA,0xFF,"S","Start Midi",DATA_TYPE_NONE,0));
  midi_cmd_db.push(new midi_cmd_t(0xFB,0xFF,"C","Continue Midi",DATA_TYPE_NONE,0));
  midi_cmd_db.push(new midi_cmd_t(0xFC,0xFF,"P","Stop Midi",DATA_TYPE_NONE,0));
  midi_cmd_db.push(new midi_cmd_t(0xFE,0xFF,"A","Active Sending",DATA_TYPE_NONE,0));
  midi_cmd_db.push(new midi_cmd_t(0xFF,0xFF,"R","Reset",DATA_TYPE_NONE,0));
}

function get_midi_cmd(status)
{
  for (var i = 0; i < midi_cmd_db.length; i++)
  {
    if ((midi_cmd_db[i].status & midi_cmd_db[i].status_mask) == (status & midi_cmd_db[i].status_mask))
    {
      return midi_cmd_db[i];
    }
  }
  return new midi_cmd_t(status,0xFF,"?","Unknown command",DATA_TYPE_UNKNOWN,-1);
}

function build_midi_header_dec_item (cmd, status, start_sample, end_sample)
{
    var ch_text = "";
    var ch_text_short = "";

    if (cmd.status_mask == 0xF0)
    {
        ch_text = ", CH " +  ((status & 0x0F) + 1).toString();
        ch_text_short =  " " + ((status & 0x0F) + 1).toString();
    }

    ScanaStudio.dec_item_new(ch, start_sample, end_sample);
    ScanaStudio.dec_item_add_content(cmd.long_name + ch_text);
    ScanaStudio.dec_item_add_content(cmd.short_name + ch_text_short);
    ScanaStudio.dec_item_add_content(cmd.short_name);
    ScanaStudio.dec_item_end();

    ScanaStudio.packet_view_add_packet(true, ch, start_sample, -1, "MIDI", "CH" + (ch + 1), ScanaStudio.get_channel_color(ch), ScanaStudio.get_channel_color(ch));
    ScanaStudio.packet_view_add_packet(false, ch, start_sample, end_sample, "Message", cmd.long_name + ch_text, "#FF66CC", "#FF99CC");
}

function build_midi_data_dec_items(midi_cmd, data_array, start_sample, end_sample)
{
  ScanaStudio.dec_item_new(ch, start_sample, end_sample);

  var content_long = "";
  var content_short = "";

  switch (midi_cmd.data_type) {
    case DATA_TYPE_NOTE_VELOCITY:
      content_long = "Note = " + tab_note[data_array[0]] + ", velocity = " + data_array[1];
      content_short = tab_note[data_array[0]] + "/" + data_array[1];
      break;
    case DATA_TYPE_BYTE:
      content_long = data_array[0];
      break;
    case DATA_TYPE_LSB_MSB:
      content_long = data_array[0] + (data_array[1] << 7);
      break;
    case DATA_TYPE_TIMECODE:
      switch ((data_array[0] >> 4)) {
        case 0:
          content_long = "Frame number LSB = " + (data_array[0] & 0xF);
          content_short = (data_array[0] & 0xF);
          break;
        case 1:
          content_long = "Frame number MSB = " + (data_array[0] & 0x1);
          content_short = (data_array[0] & 0xF);
          break;
        case 2:
          content_long = "Second LSB = " + (data_array[0] & 0xF);
          content_short = (data_array[0] & 0xF);
          break;
        case 3:
          content_long = "Second MSB = " + (data_array[0] & 0x3);
          content_short = (data_array[0] & 0xF);
          break;
        case 4:
          content_long = "Minute LSB = " + (data_array[0] & 0xF);
          content_short = (data_array[0] & 0xF);
          break;
        case 5:
          content_long = "Minute MSB = " + (data_array[0] & 0x3);
          content_short = (data_array[0] & 0xF);
          break;
        case 6:
          content_long = "Hour LSB = " + (data_array[0] & 0xF);
          content_short = (data_array[0] & 0xF);
          break;
        case 7:
          content_long = "Hour MSB = " + (data_array[0] & 0x1) + ", Rate = " + ((data_array[0] >> 1)& 0x3);
          content_short = (data_array[0] & 0x1) + " / " + ((data_array[0] >> 1)& 0x3);
          break;
        default:
      }
      break;
    case DATA_TYPE_CTRLNUM_VALUE:
      if (data_array[0] < 120)
      {
        content_long = "Controller number = " + data_array[0] + ", Controller value = " +  data_array[1];
        content_short =  data_array[0] + " / " + data_array[1] ;
      }
      else
      {
        switch (data_array[0]) {
          case 120:
            if (data_array[1] == 0)
            {
              content_long = "All sound OFF";
              content_short = "S.OFF";
            }
            else
            {
              content_long = "Unexpected value: " + data_array[1];
              content_short = data_array[1];
              ScanaStudio.dec_item_emphasize_warning();
            }
            break;
          case 121:
            content_long = "Reset All controllers";
            content_short = "RESET";
            break;
          case 122:
            if (data_array[1] == 0)
            {
              content_long = "Local control OFF";
              content_short = "Loc. OFF";
            }
            else if (data_array[1] == 127)
            {
              content_long = "Local control ON";
              content_short = "Loc. ON";
            }
            else
            {
              content_long = "Unexpected value: " + data_array[1];
              content_short = data_array[1];
              ScanaStudio.dec_item_emphasize_warning();
            }
            break;
          case 123:
            if (data_array[1] == 0)
            {
              content_long = "All Notes OFF";
              content_short = "N.OFF";
            }
            else
            {
              content_long = "Unexpected value: " + data_array[1];
              content_short = data_array[1];
              ScanaStudio.dec_item_emphasize_warning();
            }
            break;
          case 124:
            if (data_array[1] == 0)
            {
              content_long = "Omni Mode OFF";
              content_short = "O.OFF";
            }
            else
            {
              content_long = "Unexpected value: " + data_array[1];
              content_short = data_array[1];
              ScanaStudio.dec_item_emphasize_warning();
            }
            break;
            case 125:
              if (data_array[1] == 0)
              {
                content_long = "Omni Mode ON";
                content_short = "O.ON";
              }
              else
              {
                content_long = "Unexpected value: " + data_array[1];
                content_short = data_array[1];
                ScanaStudio.dec_item_emphasize_warning();
              }
              break;
            case 126:
              if (data_array[1] == 0)
              {
                content_long = "Omni Mode ON";
                content_short = "O.ON";
              }
              else
              {
                content_long = "Mono Mode ON, Channels = " + data_array[1];
                content_short = "M.ON " + data_array[1];
              }
              break;
          default:

        }
      }
      break;
    default:
  }

  if (content_long != "")
  {
    ScanaStudio.dec_item_add_content(content_long);
  }
  if (content_short != "")
  {
    ScanaStudio.dec_item_add_content(content_short);
  }

  ScanaStudio.dec_item_end();
  ScanaStudio.packet_view_add_packet(false, ch, start_sample, end_sample, "Data", content_long, "#33FFFF", "#99FFFF");
}

function midi_cmd_t(status,status_mask,short_name,long_name,data_type,len)
{
  this.status = status;
  this.status_mask = status_mask;
  this.short_name = short_name;
  this.long_name = long_name;
  this.data_type = data_type;
  this.len = len;
}

var tab_note = ["C-5 ", "C#-5 ", "D-5 ", "D#-5 ", "E-5 ", "F-5 ", "F#-5 ", "G-5 ", "G#-5 ", "A-5 ", "A#-5 ", "B-5 ",
				"C-4 ", "C#-4 ", "D-4 ", "D#-4 ", "E-4 ", "F-4 ", "F#-4 ", "G-4 ", "G#-4 ", "A-4 ", "A#-4 ", "B-4 ",
				"C-3 ", "C#-3 ", "D-3 ", "D#-3 ", "E-3 ", "F-3 ", "F#-3 ", "G-3 ", "G#-3 ", "A-3 ", "A#-3 ", "B-3 ",
				"C-2 ", "C#-2 ", "D-2 ", "D#-2 ", "E-2 ", "F-2 ", "F#-2 ", "G-2 ", "G#-2 ", "A-2 ", "A#-2 ", "B-2 ",
				"C-1 ", "C#-1 ", "D-1 ", "D#-1 ", "E-1 ", "F-1 ", "F#-1 ", "G-1 ", "G#-1 ", "A-1 ", "A#-1 ", "B-1 ",
				"C0 ", "C#0 ", "D0 ", "D#0 ", "E0 ", "F0 ", "F#0 ", "G0 ", "G#0 ", "A0 ", "A#0 ", "B0 ",
				"C1 ", "C#1 ", "D1 ", "D#1 ", "E1 ", "F1 ", "F#1 ", "G1 ", "G#1 ", "A1 ", "A#1 ", "B1 ",
				"C2 ", "C#2 ", "D2 ", "D#2 ", "E2 ", "F2 ", "F#2 ", "G2 ", "G#2 ", "A2 ", "A#2 ", "B2 ",
				"C3 ", "C#3 ", "D3 ", "D#3 ", "E3 ", "F3 ", "F#3 ", "G3 ", "G#3 ", "A3 ", "A#3 ", "B3 ",
				"C4 ", "C#4 ", "D4 ", "D#4 ", "E4 ", "F4 ", "F#4 ", "G4 ", "G#4 ", "A4 ", "A#4 ", "B4 ",
				"C5 ", "C#5 ", "D5 ", "D#5 ", "E5 ", "F5 ", "F#5 ", "G5 "];
