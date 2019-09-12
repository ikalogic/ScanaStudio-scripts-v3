/* Protocol meta info:
<NAME> ARM TPIU Trace </NAME>
<DESCRIPTION>
This script decodes ARM trace TPIU bus. TRACE CTRL is currently not supported.
</DESCRIPTION>
<VERSION> 0.1 </VERSION>
<AUTHOR_NAME>  Ibrahim KAMAL </AUTHOR_NAME>
<AUTHOR_URL> i.kamal@ikalogic.com </AUTHOR_URL>
<HELP_URL> https://github.com/ikalogic/ScanaStudio-scripts-v3/wiki </HELP_URL>
<COPYRIGHT> Copyright Ibrahim KAMAL </COPYRIGHT>
<LICENSE>  This code is distributed under the terms of the GNU General Public License GPLv3 </LICENSE>
<RELEASE_NOTES>
V0.1:  Initial release.
</RELEASE_NOTES>
*/

//Decoder GUI
var default_tpiu_width = 4;
var first_data_ch = 1;
function on_draw_gui_decoder()
{
  //Define decoder configuration GUI
  ScanaStudio.gui_add_ch_selector("tpiu_clk","TPIU Trace Clock","Clock");
  for (var i = first_data_ch; i < ScanaStudio.get_device_channels_count(); i++)
  {
    ScanaStudio.gui_add_combo_box("tpiu_gui_d"+i.toString(10),"TRACE DATA " + (i).toString())
    for (var c = 0; c < ScanaStudio.get_device_channels_count(); c++)
    {
      ScanaStudio.gui_add_item_to_combo_box("CH"+(c+1).toString(),((c == i) && ((i-first_data_ch) < default_tpiu_width)));
    }
    ScanaStudio.gui_add_item_to_combo_box("Not used",((i-first_data_ch) >= default_tpiu_width));
  }

  ScanaStudio.gui_add_new_tab("Advanced options",false);
    ScanaStudio.gui_add_combo_box("id_format","ID display format");
      ScanaStudio.gui_add_item_to_combo_box("HEX",true);
      ScanaStudio.gui_add_item_to_combo_box("Binary",false);
      ScanaStudio.gui_add_item_to_combo_box("Decimal",false);
    ScanaStudio.gui_add_combo_box("data_format","Data display format");
      ScanaStudio.gui_add_item_to_combo_box("HEX",true);
      ScanaStudio.gui_add_item_to_combo_box("Binary",false);
      ScanaStudio.gui_add_item_to_combo_box("Decimal",false);
      ScanaStudio.gui_add_item_to_combo_box("ASCII",false);
  ScanaStudio.gui_end_tab();
}


var tpiu_clk_channel;
var tpiu_data_channel = [];
function parse_gui()
{
  var ch;
  tpiu_clk_channel = ScanaStudio.gui_get_value("tpiu_clk");
  id_format = ScanaStudio.gui_get_value("id_format");
  data_format = ScanaStudio.gui_get_value("data_format");
  tpiu_data_channel = [];
  for (var i = first_data_ch; i < ScanaStudio.get_device_channels_count(); i++)
  {
    ch = ScanaStudio.gui_get_value("tpiu_gui_d"+i.toString(10));
    if (ch == ScanaStudio.get_device_channels_count())
    {
      break; //we have reached a "not used" TPIU DATA channel
    }
    else
    {
      tpiu_data_channel.push(ch);
    }
  }
}


var tpiu_partial_words = [];
var tpiu_frame = []; //16 bytes
var tpiu_word; //16 bits
var trs_clk;
var trs_data = [];
var clk_edge_fifo = [];
var tpiu_bits;
var partial_word_counter;
var sync_found = false;
function on_decode_signals(resume)
{
  var sync_word;
  if (!resume) //If resume == false, it's the first call to this function.
  {
      //initialization code goes here, ex:
      parse_gui();
      prev_id = 0;
      sync_found = false;
      tpiu_partial_words = [];
      for (var i = 0; i < (32/tpiu_data_channel.length); i++)
      {
        tpiu_partial_words.push(0);
      }
      trs_data = [];
      tpiu_frame = [];
      //reset iterators
      ScanaStudio.trs_reset(tpiu_clk_channel);
      for (var i = 0; i < tpiu_data_channel.length; i++)
      {
        ScanaStudio.trs_reset(tpiu_data_channel[i]);
        trs_data[i] = ScanaStudio.trs_get_next(tpiu_data_channel[i]);
      }
  }

  while ((ScanaStudio.abort_is_requested() == false) && (ScanaStudio.trs_is_not_last(tpiu_clk_channel)))
  {
    trs_clk = ScanaStudio.trs_get_next(tpiu_clk_channel);
    clk_edge_fifo.push(trs_clk.sample_index);
    if (clk_edge_fifo.length > 32)
    {
      clk_edge_fifo.shift();
    }
    //advance all DATA iterators right after the CLK edge
    for (var i = 0; i < tpiu_data_channel.length; i++)
    {
      while (trs_data[i].sample_index <= trs_clk.sample_index)
      {
        trs_data[i] = ScanaStudio.trs_get_next(tpiu_data_channel[i]);
      }
    }

    for (var i = 0; i < ((32/tpiu_data_channel.length)-1); i++)
    {
      tpiu_partial_words[i] = tpiu_partial_words[i+1];
    }
    tpiu_partial_words[((32/tpiu_data_channel.length)-1)] = build_tpiu_bits();
    //ScanaStudio.console_info_msg("tpiu_bits="+build_tpiu_bits().toString(16),trs_clk.sample_index);
    sync_word = 0;
    for (var i = ((32/tpiu_data_channel.length)-1); i >= 0 ; i--)
    {
      sync_word = (sync_word * 16) + tpiu_partial_words[i];
    }

    if (sync_word == 0x7FFFFFFF)
    {
      //ScanaStudio.console_info_msg("Sync word found!",trs_clk.sample_index);
      ScanaStudio.dec_item_new(tpiu_clk_channel,clk_edge_fifo[31-(32/tpiu_data_channel.length)],clk_edge_fifo[31]);
      ScanaStudio.dec_item_add_content("Frame synchronization packet 0x7FFFFFFF");
      ScanaStudio.dec_item_add_content("Sync packet");
      ScanaStudio.dec_item_add_content("Sync");
      ScanaStudio.dec_item_end();
      sync_word = 0;
      partial_word_counter = 0;
      sync_found = true;
      tpiu_frame = [];
      continue;
    }

    if (!sync_found) continue; //until we're sync'ed

    partial_word_counter++;
    if (partial_word_counter >= (16 / tpiu_data_channel.length)) //Wait for 16 bits
    {
      //Now parse the word
      tpiu_word = 0;
      for (var i = ((32/tpiu_data_channel.length)-1); i >= ((32/tpiu_data_channel.length)-partial_word_counter) ; i--)
      {
        tpiu_word = (tpiu_word * 16) + tpiu_partial_words[i];
      }

      if (tpiu_word == 0x7FFF)
      {
        ScanaStudio.dec_item_new(tpiu_clk_channel,clk_edge_fifo[31-(16/tpiu_data_channel.length)],clk_edge_fifo[31]);
        ScanaStudio.dec_item_add_content("Halfword synchronization packet 0x7FFF");
        ScanaStudio.dec_item_add_content("Halfword sync packet");
        ScanaStudio.dec_item_add_content("Half Sync");
        ScanaStudio.dec_item_add_content("HS");
        ScanaStudio.dec_item_end();
      }
      else
      {
        //ScanaStudio.console_info_msg("partial_word_counter = " + partial_word_counter + ", tpiu data = 0x" + tpiu_word.toString(16),trs_clk.sample_index);
        //Push two bytes into tpiu_frame
        tpiu_frame.push(new TpiuByteCtor((tpiu_word & 0xFF),clk_edge_fifo[31-(16/tpiu_data_channel.length)]+1,clk_edge_fifo[31-(8/tpiu_data_channel.length)]-1));
        tpiu_frame.push(new TpiuByteCtor(((tpiu_word >>> 8) & 0xFF),clk_edge_fifo[31-(8/tpiu_data_channel.length)]+1,clk_edge_fifo[31]-1));
        if (tpiu_frame.length >= 16)
        {
          //ScanaStudio.console_info_msg("tpiu_frame[0]="+tpiu_frame[0].data);
          parse_tpiu_frame(tpiu_frame);
          tpiu_frame = [];
        }
      }
      partial_word_counter = 0;

    }
  }
}

function TpiuByteCtor(data,start_sample,end_sample)
{
  this.data = data;
  this.start_sample = start_sample;
  this.end_sample = end_sample;
};

function build_tpiu_bits()
{
  var bits = 0;
  for (var i = 0; i < tpiu_data_channel.length; i++)
  {
      bits |= ((~trs_data[i].value) & 0x1) << i;
  }
  return bits;
}

var prev_id; //must be global
function parse_tpiu_frame(frame)
{
  var i;
  var next_id = 0;
  var next_id_counter = 0;
  ScanaStudio.packet_view_add_packet(true,tpiu_clk_channel,frame[0].start_sample,frame[15].end_sample,
                                    "TPIU TRACE","CH" + (tpiu_clk_channel+1).toString(),
                                    ScanaStudio.get_channel_color(tpiu_clk_channel),ScanaStudio.get_channel_color(tpiu_clk_channel));
  for (i = 0; i < 15; i++)
  {
      if ((i%2)) //even byte, always data
      {
          if (next_id_counter == 1)
          {
              prev_id = next_id;
          }
          tpiu_append_data(prev_id, frame[i].data,frame[i].start_sample,frame[i].end_sample);

          next_id_counter++;
      }
      else if (frame[i].data & 0x1) //ID change
      {
          ScanaStudio.dec_item_new(tpiu_clk_channel,frame[i].start_sample, frame[i].end_sample);
          if ((frame[15].data >>> (i/2)) & 0x1) //AUX bit is set: ID change takes effect after one data byte.
          {
              next_id = frame[i].data >>> 1;
              ScanaStudio.dec_item_add_content("Delayed ID change: " + format_content(next_id,id_format,7));
              ScanaStudio.dec_item_add_content("Delayed ID " + format_content(next_id,id_format,7));
              ScanaStudio.dec_item_add_content("D.ID " + format_content(next_id,id_format,7));
          }
          else    //AUX bit cleared, ID change takes effect now.
          {
              prev_id = frame[i].data >>> 1;
              next_id = prev_id;
              ScanaStudio.dec_item_add_content("ID change: " + format_content(next_id,id_format,7));
              ScanaStudio.dec_item_add_content("ID " + format_content(next_id,id_format,7));
          }
          ScanaStudio.dec_item_add_content(format_content(next_id,id_format,7));
          ScanaStudio.dec_item_end();
          next_id_counter = 0;
      }
      else //DATA byte
      {
          if (next_id_counter == 1)
          {
              prev_id = next_id;
          }
          tpiu_append_data(prev_id, (frame[i].data & 0xFE) | ((frame[15].data >>> (i/2)) & 0x1), frame[i].start_sample, frame[i].end_sample);
          next_id_counter++;
      }
  }
  ScanaStudio.dec_item_new(tpiu_clk_channel,frame[15].start_sample, frame[15].end_sample);
  ScanaStudio.dec_item_add_content("(Auxilary bits = " + format_content(frame[15].data,1/*Binary*/,8) );
  ScanaStudio.dec_item_add_content("(Aux. bits = " + format_content(frame[15].data,1/*Binary*/,8) );
  ScanaStudio.dec_item_add_content("(Aux: " + format_content(frame[15].data,1/*Binary*/,8) );
  ScanaStudio.dec_item_add_content(format_content(frame[15].data,1/*Binary*/,8) );
  ScanaStudio.dec_item_add_content("AUX");
  ScanaStudio.dec_item_add_content("A");
  ScanaStudio.dec_item_end();

  ScanaStudio.packet_view_add_packet(false,tpiu_clk_channel,frame[15].start_sample, frame[15].end_sample,
                                    "Auxilary bits", format_content(frame[15].data,1/*Binary*/,8),
                                    ScanaStudio.PacketColors.Misc.Title,ScanaStudio.PacketColors.Misc.Content);
}

function tpiu_append_data(id,data,start,end)
{
  ScanaStudio.dec_item_new(tpiu_clk_channel,start, end);
  ScanaStudio.dec_item_add_content("(ID = " + format_content(id,id_format,7) + "), Data = " + format_content(data,data_format,8));
  ScanaStudio.dec_item_add_content("(ID = " + format_content(id,id_format,7) + "), D: " + format_content(data,data_format,8));
  ScanaStudio.dec_item_add_content("D: " + format_content(data,data_format,8));
  ScanaStudio.dec_item_add_content(format_content(data,data_format,8));
  ScanaStudio.dec_item_end();

  ScanaStudio.packet_view_add_packet(false,tpiu_clk_channel,start,end,
                                    "ID: " + format_content(id,id_format,7),"DATA: " + format_content(data,data_format,8),
                                    ScanaStudio.PacketColors.Data.Title,ScanaStudio.PacketColors.Data.Content);
}


/*
  Helper function to convert data to formated text
  according to formating options set by the user
*/
function format_content (data, data_format, size_bits)
{
    switch (data_format)
    {
        case 0: //HEX
        return "0x" + pad(data.toString(16),Math.ceil(size_bits/4));
        break;

        case 1: //Binary
        return to_binary_str(data,size_bits);
        break;

        case 2: // Dec
        return data.toString(10);
        break;

        case 3: //ASCII
        return " '" + String.fromCharCode(data) + "'"
        break;

        default: break;
    }
}

/* Helper fonction to convert value to binary, including 0-padding
  and groupping by 4-bits packets
*/
function to_binary_str (value, size)
{
  var i;
  var str = pad(value.toString(2),size);
  var ret = "";

  for (i = 0; i < str.length; i+= 4)
  {
    ret += str.slice(i,(i+4)) + " ";
  }

  ret = "0b" + ret + str.slice(i);
  return ret;
}

/*  A helper function add leading "0"s to numbers
      Parameters
        * num_str: A string of the number to be be 0-padded
        * size: The total wanted size of the output string
*/
function pad (num_str, size)
{
    while (num_str.length < size) num_str = "0" + num_str;
    return num_str;
}
