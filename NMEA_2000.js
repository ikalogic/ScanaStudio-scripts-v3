/* Protocol meta info:
<NAME> NMEA_2000 </NAME>
<DESCRIPTION>
Decode most of NMEA 2000 PGN.
</DESCRIPTION>
<VERSION> 0.1 </VERSION>
<AUTHOR_NAME> Corentin MARAVAT </AUTHOR_NAME>
<AUTHOR_URL> contact@ikalogic.com </AUTHOR_URL>
<HELP_URL> https://github.com/ikalogic/ScanaStudio-scripts-v3/wiki </HELP_URL>
<COPYRIGHT> Copyright Ikalogic SAS </COPYRIGHT>
<LICENSE> This code is distributed under the terms of the GNU General Public License GPLv3 </LICENSE>
<RELEASE_NOTES>
V0.1:  Initial release.
</RELEASE_NOTES>
*/

/*
NMEA 2000 wikipedia page : https://en.wikipedia.org/wiki/NMEA_2000
PGN List (2015) : https://www.nmea.org/Assets/20151026%20nmea%202000%20pgn_website_description_list.pdf
Sum up of the NMEA features : https://www.kvaser.com/about-can/higher-layer-protocols/nmea-2000/
SAE J1939 protocol : http://www.simmasoftware.com/j1939-presentation.pdf
other sources : https://www.kvaser.com/wp-content/uploads/2014/08/nmea2000-explained-cassidy.pdf
https://copperhilltech.com/content/NMEA2K_Network_Design_v2.pdf
http://read.pudn.com/downloads367/doc/comm/1590119/Sept_1__2008_NMEA2000_Main_1.201.pdf
https://www.nmea.org/Assets/2000-explained-white-paper.pdf
A long list of PGN with the field significance : https://github.com/canboat/canboat/blob/master/analyzer/pgn.h (The list is incomplete)
*/



//Decoder GUI
function on_draw_gui_decoder()
{
    //Define decoder configuration GUI
    ScanaStudio.gui_add_ch_selector("ch","NMEA Channel","NMEA");
    ScanaStudio.gui_add_engineering_form_input_box("rate","Bit rate",100,1e6,250e3,"Bit/s");
    ScanaStudio.gui_add_check_box("can_fd_iso","CAN FD ISO CRC (ISO 11898-1:2015)",false);
    ScanaStudio.gui_add_new_tab("Display options",false);
      ScanaStudio.gui_add_combo_box("id_format","ID display format");
        ScanaStudio.gui_add_item_to_combo_box("HEX",true);
        ScanaStudio.gui_add_item_to_combo_box("Binary",false);
        ScanaStudio.gui_add_item_to_combo_box("Decimal",false);
      ScanaStudio.gui_add_combo_box("data_format","Data display format");
        ScanaStudio.gui_add_item_to_combo_box("HEX",true);
        ScanaStudio.gui_add_item_to_combo_box("Binary",false);
        ScanaStudio.gui_add_item_to_combo_box("Decimal",false);
      ScanaStudio.gui_add_combo_box("crc_format","CRC display format");
        ScanaStudio.gui_add_item_to_combo_box("HEX",true);
        ScanaStudio.gui_add_item_to_combo_box("Binary",false);
        ScanaStudio.gui_add_item_to_combo_box("Decimal",false);
    ScanaStudio.gui_end_tab();

    //Add hidden elements for the CAN decoder
    ScanaStudio.gui_add_hidden_field("rate_fd",2);
}

//Evaluate decoder GUI
function on_eval_gui_decoder()
{
    sampling_rate = ScanaStudio.get_capture_sample_rate();
    var max_rate = sampling_rate/8; //We need at least that much points per bit period for correct decoding
    rate = ScanaStudio.gui_get_value("rate");
    if (rate > max_rate)
    {
      return ("Selected bit rate of " + ScanaStudio.engineering_notation(rate,5) + "Hz"
              + " is too high compared to device sampling rate of " + ScanaStudio.engineering_notation(sampling_rate,5) + "Hz\n"
              + "(Maximum allowable bit rate is " + ScanaStudio.engineering_notation(max_rate,5) + "Hz"
            );
    }
    return "" //All good.
}

//Global variables
var sampling_rate;
var item_content = "";
var start_item = 0;
var end_item = 0;
var multi_byte_value = 0;
var hex_value = 0;
// Identification Sequence
// 11 first bits
var priority_bits_value = 0;
var data_page = 0;
var pgn_high = 0;
var bit_value = 0;
var end_priority_item = 0;
var end_pgn = 0;
var pgn = 0;
// 18 last bits
var sender_adress = 0;
var pgn_name = "UNKNOWN PGN NAME AND DATA FIELDS";
// Data Multi Packets (Transfer Protocol Message)
var pgn_pf = 0;
var pgn_ps = 0;
var skip_item = false;
var size_low = 0;
var data_nb = 0;
var byte_nb = 1;
// Packet View
var packet_title = "";
var types_title = "";
var types_content = "";
// Fast Packet
var fast_packet = false;
var fast_packet_total_byte = -1;
var fast_packet_byte = 0;
// Date variable
var system_time = new Date(1);


function on_decode_signals(resume)
{
  if (!resume) //If resume == false, it's the first call to this function.
  {
      //initialization code goes here, ex:
      sampling_rate = ScanaStudio.get_capture_sample_rate();
      ch = ScanaStudio.gui_get_value("ch");
      rate = ScanaStudio.gui_get_value("rate");
      id_format = ScanaStudio.gui_get_value("id_format");
      data_format = ScanaStudio.gui_get_value("data_format");
      crc_format = ScanaStudio.gui_get_value("crc_format");
      samples_per_bit_std =  Math.floor(sampling_rate / rate);

      var can_items = ScanaStudio.pre_decode("can.js", resume);

      for (i=0; i < can_items.length; i++)
      {
          //Interpret can_items[i] and create new decoder items with your interpreted data
          if (can_items[i].content.search("Start") != -1)
          {
              ScanaStudio.dec_item_new(can_items[i].channel_index,can_items[i].start_sample_index + 1, can_items[i].end_sample_index);
              ScanaStudio.dec_item_add_content(can_items[i].content);
              ScanaStudio.dec_item_add_content("SOF");
              ScanaStudio.dec_item_end();
              // Packet View (Packet Header)
              ScanaStudio.packet_view_add_packet(true,
                  can_items[i].channel_index,
                  can_items[i].start_sample_index,
                  can_items[i].end_sample_index,
                  "NMEA 2000",
                  "CH" + (can_items[i].channel_index + 1),
                  ScanaStudio.get_channel_color(can_items[i].channel_index),
                  ScanaStudio.get_channel_color(can_items[i].channel_index));
              // Packet View
              ScanaStudio.packet_view_add_packet(false,
                  can_items[i].channel_index,
                  can_items[i].start_sample_index,
                  can_items[i].end_sample_index,
                  "SOF",
                  "Start of the Frame",
                  ScanaStudio.PacketColors.Wrap.Title,
                  ScanaStudio.PacketColors.Wrap.Content);
          }//end Start
          else if (can_items[i].content.search("Base ID") != -1)
          {
              // Search the value into the string content
              hex_value = get_hex_value(can_items[i].content, id_format);
              // Update Variables
              priority_bits_value = 0;
              data_page = 0;
              pgn_high = 0;

              for (z=11-1; z>=0; z--)
              {
                  if (z>7)
                  {
                      bit_value = ((hex_value>>z)&0x1);
                      priority_bits_value += bit_value*Math.pow(2,(z-8));
                  }
                  if (z == 6)
                  {
                      data_page = ((hex_value>>z)&0x1);
                  }
                  if (z<6)
                  {
                      bit_value = ((hex_value>>z)&0x1);
                      pgn_high += bit_value*Math.pow(2,z);
                  }
              }
              end_priority_item = ((can_items[i].end_sample_index - can_items[i].start_sample_index)/11*3) + can_items[i].start_sample_index;
              ScanaStudio.dec_item_new(can_items[i].channel_index,can_items[i].start_sample_index + 1, end_priority_item - 1);
              ScanaStudio.dec_item_add_content("Priority bits = " + priority_bits_value);
              ScanaStudio.dec_item_add_content(priority_bits_value);
              ScanaStudio.dec_item_end();
              // Packet View
              ScanaStudio.packet_view_add_packet(false,
                  can_items[i].channel_index,
                  can_items[i].start_sample_index,
                  end_priority_item,
                  "Priority",
                  priority_bits_value,
                  ScanaStudio.PacketColors.Data.Title,
                  ScanaStudio.PacketColors.Data.Content);
              var end_reserved = end_priority_item + (can_items[i].end_sample_index - can_items[i].start_sample_index)/11;
              ScanaStudio.dec_item_new(can_items[i].channel_index,end_priority_item + 1,end_reserved);
              ScanaStudio.dec_item_add_content("Reserved");
              ScanaStudio.dec_item_add_content("R");
              ScanaStudio.dec_item_end();
              // Packet View
              ScanaStudio.packet_view_add_packet(false,
                  can_items[i].channel_index,
                  end_priority_item,
                  end_reserved,
                  "Reserved",
                  "Reserved",
                  ScanaStudio.PacketColors.Data.Title,
                  ScanaStudio.PacketColors.Data.Content);
              var end_data_page = end_reserved + (can_items[i].end_sample_index - can_items[i].start_sample_index)/11;
              ScanaStudio.dec_item_new(can_items[i].channel_index,end_reserved + 1,end_data_page );
              ScanaStudio.dec_item_add_content("Data Page : " + data_page);
              ScanaStudio.dec_item_add_content(data_page);
              ScanaStudio.dec_item_end();
              // Packet View
              ScanaStudio.packet_view_add_packet(false,
                  can_items[i].channel_index,
                  end_reserved,
                  end_data_page,
                  "Data Page",
                  data_page,
                  ScanaStudio.PacketColors.Data.Title,
                  ScanaStudio.PacketColors.Data.Content);
              ScanaStudio.dec_item_new(can_items[i].channel_index,end_data_page + 1,can_items[i].end_sample_index );
              if (id_format == 0)
              {
                  ScanaStudio.dec_item_add_content("PGN : 0x" + pad(pgn_high.toString(16),2));
                  ScanaStudio.dec_item_add_content("0x" + pad(pgn_high.toString(16),2));
              }
              else if (id_format == 1)
              {
                  ScanaStudio.dec_item_add_content("PGN : 0b" + pad(pgn_high.toString(2),6));
                  ScanaStudio.dec_item_add_content("0b" + pad(pgn_high.toString(2),6));
              }
              else
              {
                  ScanaStudio.dec_item_add_content("PGN : " + pgn_high);
                  ScanaStudio.dec_item_add_content("" + pgn_high);
              }
              ScanaStudio.dec_item_end();
              // Packet View
              ScanaStudio.packet_view_add_packet(false,
                  can_items[i].channel_index,
                  end_data_page,
                  can_items[i].end_sample_index,
                  "Start PF (6 bits)",
                  "0x" + pad(pgn_high.toString(16),2),
                  ScanaStudio.PacketColors.Data.Title,
                  ScanaStudio.PacketColors.Data.Content);
          }//end Base ID
          else if (can_items[i].content.search("SRR") != -1)
          {
              ScanaStudio.dec_item_new(can_items[i].channel_index,can_items[i].start_sample_index + 1, can_items[i].end_sample_index);
              ScanaStudio.dec_item_add_content(can_items[i].content);
              ScanaStudio.dec_item_end();
              // Packet View
              ScanaStudio.packet_view_add_packet(false,
                  can_items[i].channel_index,
                  can_items[i].start_sample_index,
                  can_items[i].end_sample_index,
                  "SRR",
                  "",
                  ScanaStudio.PacketColors.Wrap.Title,
                  ScanaStudio.PacketColors.Wrap.Content);
          }//end SRR
          else if (can_items[i].content.search("IDE") != -1)
          {
              ScanaStudio.dec_item_new(can_items[i].channel_index,can_items[i].start_sample_index + 1, can_items[i].end_sample_index);
              ScanaStudio.dec_item_add_content(can_items[i].content);
              ScanaStudio.dec_item_end();
              // Packet View
              ScanaStudio.packet_view_add_packet(false,
                  can_items[i].channel_index,
                  can_items[i].start_sample_index,
                  can_items[i].end_sample_index,
                  "IDE",
                  "",
                  ScanaStudio.PacketColors.Wrap.Title,
                  ScanaStudio.PacketColors.Wrap.Content);
          }//end IDE
          // Change the item content of the extended part of the ID
          else if (can_items[i].content.search("Extended ID") != -1)
          {
              // Search the value into the string content.
              hex_value = get_hex_value(can_items[i].content, id_format);
              // Update Variables
              pgn_ps = 0;
              sender_adress = 0;
              pgn_total = ((hex_value>>8)&0x1ffff);
              pgn_pf = (pgn_total>>8)&0xff;
              sender_adress = (hex_value)&0xFF;
              if (pgn_pf < 240) // if the 8 PF bits are inferior to 240 then the definition of the pgn isn't the same and the 8 bits of the PS designate the adress which this
              {
                  pgn_total = (pgn_pf<<8) + (data_page<<16);
                  pgn_ps = (hex_value>>8)&0xff;
              }
              // Look if it's a fast packet message and get the pgn name
              is_fast_packet(pgn_total);
              get_pgn_name(pgn_total);
              // Create the new dec items
              end_pgn = can_items[i].start_sample_index + (can_items[i].end_sample_index - can_items[i].start_sample_index)/18*10;
              ScanaStudio.dec_item_new(can_items[i].channel_index,can_items[i].start_sample_index, end_pgn);
              if ((pgn_ps == 255) && (pgn_pf < 240))
              {
                  packet_string = pgn_total + " to global adress."
                  if (id_format == 0)
                  {
                      ScanaStudio.dec_item_add_content("PGN : 0x" + pad(pgn_total.toString(16),5) + " or " + pgn_total + " (" + pgn_name + ") and designate a global adress");
                      ScanaStudio.dec_item_add_content("PGN : 0x" + pad(pgn_total.toString(16),5) + " or " + pgn_total + " and designate a global adress");
                      ScanaStudio.dec_item_add_content("PGN : 0x" + pad(pgn_total.toString(16),5));
                      ScanaStudio.dec_item_add_content("0x" + pad(pgn_total.toString(16),5));
                  }
                  else if (id_format == 1)
                  {
                     ScanaStudio.dec_item_add_content("PGN : 0b" + pad(pgn_total.toString(2),17) + " or " + pgn_total + " and designate a global adress");
                     ScanaStudio.dec_item_add_content("PGN : 0b" + pad(pgn_total.toString(2),17));
                     ScanaStudio.dec_item_add_content("0b" + pad(pgn_total.toString(2),17));
                  }
                  else
                  {
                      ScanaStudio.dec_item_add_content("PGN : " + pgn_total + " and designate a global adress");
                      ScanaStudio.dec_item_add_content("PGN : " + pgn_total);
                      ScanaStudio.dec_item_add_content(pgn_total);
                  }
              }
              else if ((pgn_ps == 254) && (pgn_pf < 240))
              {
                  packet_string = pgn_total + " to null adress."
                  if (id_format == 0)
                  {
                      ScanaStudio.dec_item_add_content("PGN : 0x" + pad(pgn_total.toString(16),5) + " or " + pgn_total + " (" + pgn_name + ") and designate a null adress");
                      ScanaStudio.dec_item_add_content("PGN : 0x" + pad(pgn_total.toString(16),5) + " or " + pgn_total + " and designate a null adress");
                      ScanaStudio.dec_item_add_content("PGN : 0x" + pad(pgn_total.toString(16),5));
                      ScanaStudio.dec_item_add_content("0x" + pad(pgn_total.toString(16),5));
                  }
                  else if (id_format == 1)
                  {
                      ScanaStudio.dec_item_add_content("PGN : 0b" + pad(pgn_total.toString(2),17) + " or " + pgn_total + " and designate a null adress");
                      ScanaStudio.dec_item_add_content("PGN : 0b" + pad(pgn_total.toString(2),17));
                      ScanaStudio.dec_item_add_content("0b" + pad(pgn_total.toString(2),17));
                  }
                  else
                  {
                      ScanaStudio.dec_item_add_content("PGN : " + pgn_total + " and designate a null adress");
                      ScanaStudio.dec_item_add_content("PGN : " + pgn_total);
                      ScanaStudio.dec_item_add_content(pgn_total);
                  }
              }
              else if(pgn_pf < 240)
              {
                  packet_string = pgn_total + " to adress 0x" + pad(pgn_ps.toString(16),2);
                  if (id_format == 0)
                  {
                      ScanaStudio.dec_item_add_content("PGN : 0x" + pad(pgn_total.toString(16),5) + " or " + pgn_total + " (" + pgn_name + ") and designate adress 0x" + pad(pgn_ps.toString(16),2));
                      ScanaStudio.dec_item_add_content("PGN : 0x" + pad(pgn_total.toString(16),5) + " or " + pgn_total + " and designate adress 0x" + pad(pgn_ps.toString(16),2));
                      ScanaStudio.dec_item_add_content("PGN : 0x" + pad(pgn_total.toString(16),5));
                      ScanaStudio.dec_item_add_content("0x" + pad(pgn_total.toString(16),5));
                  }
                  else if (id_format == 1)
                  {
                      ScanaStudio.dec_item_add_content("PGN : 0b" + pad(pgn_total.toString(2),17) + " or " + pgn_total + " and designate adress 0b" + pad(pgn_ps.toString(2),8));
                      ScanaStudio.dec_item_add_content("PGN : 0b" + pad(pgn_total.toString(2),17));
                      ScanaStudio.dec_item_add_content("0b" + pad(pgn_total.toString(2),17));
                  }
                  else
                  {
                      ScanaStudio.dec_item_add_content("PGN : " + pgn_total + " and designate adress " + pgn_ps);
                      ScanaStudio.dec_item_add_content("PGN : " + pgn_total);
                      ScanaStudio.dec_item_add_content(pgn_total);
                  }
              }
              else
              {
                  packet_string = pgn_total + " to global adress";
                  if (id_format == 0)
                  {
                      ScanaStudio.dec_item_add_content("PGN : 0x" + pad(pgn_total.toString(16),5) + " or " + pgn_total + " (" + pgn_name + ") and designate a global adress");
                      ScanaStudio.dec_item_add_content("PGN : 0x" + pad(pgn_total.toString(16),5) + " or " + pgn_total + " and designate a global adress");
                      ScanaStudio.dec_item_add_content("PGN : 0x" +  pad(pgn_total.toString(16),5));
                      ScanaStudio.dec_item_add_content("0x" + pad(pgn_total.toString(16),5));
                  }
                  else if (id_format == 1)
                  {
                      ScanaStudio.dec_item_add_content("PGN : 0b" + pad(pgn_total.toString(2),17) + " or " + pgn_total + " and designate a global adress");
                      ScanaStudio.dec_item_add_content("PGN : 0b" + pad(pgn_total.toString(2),17));
                      ScanaStudio.dec_item_add_content("0b" + pad(pgn_total.toString(2),17));
                  }
                  else
                  {
                      ScanaStudio.dec_item_add_content("PGN : " + pgn_total + " and designate a global adress");
                      ScanaStudio.dec_item_add_content("PGN : " + pgn_total);
                      ScanaStudio.dec_item_add_content(pgn_total);
                  }
              }
              ScanaStudio.dec_item_end();
              // Packet View
              ScanaStudio.packet_view_add_packet(false,
                  can_items[i].channel_index,
                  can_items[i].start_sample_index,
                  can_items[i].end_sample_index,
                  "PGN",
                  packet_string,
                  ScanaStudio.PacketColors.Data.Title,
                  ScanaStudio.PacketColors.Data.Content);
              // Packet View (PGN Name)
              ScanaStudio.packet_view_add_packet(false,
                  can_items[i].channel_index,
                  can_items[i].start_sample_index + 1,
                  can_items[i].end_sample_index + 1,
                  "PGN NAME",
                  pgn_name,
                  ScanaStudio.PacketColors.Data.Title,
                  ScanaStudio.PacketColors.Data.Content);
              ScanaStudio.dec_item_new(can_items[i].channel_index,end_pgn + 1,can_items[i].end_sample_index );
              if (id_format == 0)
              {
                  ScanaStudio.dec_item_add_content("Sender_adress : 0x" + pad(sender_adress.toString(16),2));
                  ScanaStudio.dec_item_add_content("0x" + pad(sender_adress.toString(16),2));
              }
              else if (id_format == 1)
              {
                  ScanaStudio.dec_item_add_content("Sender_adress : 0b" + pad(sender_adress.toString(2),8));
                  ScanaStudio.dec_item_add_content("0b" + pad(sender_adress.toString(2),8));
              }
              else
              {
                  ScanaStudio.dec_item_add_content("Sender_adress : " + sender_adress);
                  ScanaStudio.dec_item_add_content(sender_adress);
              }
              ScanaStudio.dec_item_end();
              // Packet View
              ScanaStudio.packet_view_add_packet(false,
                  can_items[i].channel_index,
                  can_items[i].start_sample_index,
                  can_items[i].end_sample_index,
                  "Sender Adress",
                  "0x" + pad(sender_adress.toString(16),2),
                  ScanaStudio.PacketColors.Data.Title,
                  ScanaStudio.PacketColors.Data.Content);
          }//end Extended ID
          // Create packet view for RTR
          else if (can_items[i].content.search("RTR") != -1)
          {
              ScanaStudio.dec_item_new(can_items[i].channel_index,can_items[i].start_sample_index + 1, can_items[i].end_sample_index);
              ScanaStudio.dec_item_add_content(can_items[i].content);
              ScanaStudio.dec_item_end();
              // Packet View
              ScanaStudio.packet_view_add_packet(false,
                  can_items[i].channel_index,
                  can_items[i].start_sample_index,
                  can_items[i].end_sample_index,
                  "RTR",
                  can_items[i].content[6],
                  ScanaStudio.PacketColors.Wrap.Title,
                  ScanaStudio.PacketColors.Wrap.Content);
          }//end RTR
          // Create packet view for R1
          else if (can_items[i].content.search("R1") != -1)
          {
              ScanaStudio.dec_item_new(can_items[i].channel_index,can_items[i].start_sample_index + 1, can_items[i].end_sample_index);
              ScanaStudio.dec_item_add_content(can_items[i].content);
              ScanaStudio.dec_item_end();
              // Packet View
              ScanaStudio.packet_view_add_packet(false,
                  can_items[i].channel_index,
                  can_items[i].start_sample_index,
                  can_items[i].end_sample_index,
                  "R1",
                  can_items[i].content[5],
                  ScanaStudio.PacketColors.Wrap.Title,
                  ScanaStudio.PacketColors.Wrap.Content);
          }//end R1
          // Create packet view for R0
          else if (can_items[i].content.search("R0") != -1)
          {
              ScanaStudio.dec_item_new(can_items[i].channel_index,can_items[i].start_sample_index + 1, can_items[i].end_sample_index);
              ScanaStudio.dec_item_add_content(can_items[i].content);
              ScanaStudio.dec_item_end();
              // Packet View
              ScanaStudio.packet_view_add_packet(false,
                  can_items[i].channel_index,
                  can_items[i].start_sample_index,
                  can_items[i].end_sample_index,
                  "R0",
                  can_items[i].content[5],
                  ScanaStudio.PacketColors.Wrap.Title,
                  ScanaStudio.PacketColors.Wrap.Content);
          }//end R0
          // Create packet view for DLC
          else if (can_items[i].content.search("DLC") != -1)
          {
              // Search the value into the string content.
              hex_value = get_hex_value(can_items[i].content, 2);
              // Create the new dec items
              if (hex_value == 8)
              {
                  ScanaStudio.dec_item_new(can_items[i].channel_index, can_items[i].start_sample_index,can_items[i].end_sample_index);
                  ScanaStudio.dec_item_add_content("DLC = " + hex_value);
                  ScanaStudio.dec_item_add_content(hex_value);
                  ScanaStudio.dec_item_end();
                  // Packet View
                  ScanaStudio.packet_view_add_packet(false,
                      can_items[i].channel_index,
                      can_items[i].start_sample_index,
                      can_items[i].end_sample_index,
                      "DLC",
                      hex_value,
                      ScanaStudio.PacketColors.Data.Title,
                      ScanaStudio.PacketColors.Data.Content);
              }
              else // All NMEA 2000 frame shall have 8 bytes data
              {
                  ScanaStudio.dec_item_new(can_items[i].channel_index, can_items[i].start_sample_index,can_items[i].end_sample_index);
                  ScanaStudio.dec_item_add_content("DLC = " + hex_value + " (shall be 8)");
                  ScanaStudio.dec_item_add_content("DLC = " + hex_value);
                  ScanaStudio.dec_item_add_content(hex_value);
                  ScanaStudio.dec_item_emphasize_warning();
                  ScanaStudio.dec_item_end();
                  // Packet View
                  ScanaStudio.packet_view_add_packet(false,
                      can_items[i].channel_index,
                      can_items[i].start_sample_index,
                      can_items[i].end_sample_index,
                      "DLC",
                      hex_value,
                      ScanaStudio.PacketColors.Error.Title,
                      ScanaStudio.PacketColors.Error.Content);
              }
              data_nb = 0; // Next data byte is the first one after the DLC
          }//end DLC
          // Change the item content of DATA byte
          else if (can_items[i].content.search("DATA") != -1)
          {
              hex_value = get_hex_value(can_items[i].content, data_format);
              types_title = ScanaStudio.PacketColors.Data.Title;
              types_content = ScanaStudio.PacketColors.Data.Content;
              if (pgn_total == 60416) // Transport Protocol (BAM/RTS/CTS/Ack/Abort message)
              {
                  switch (data_nb)
                  {
                      case 0 : // First data byte of the frame
                      {
                          if (hex_value == 16)
                          {
                              packet_title = "RTS Message";
                              item_content = hex_value + " (RTS Message)";
                          }
                          else if (hex_value == 17)
                          {
                              packet_title = "CTS Message";
                              item_content = hex_value + " (CTS Message)";
                          }
                          else if (hex_value == 19)
                          {
                              packet_title = "END Ack Message";
                              item_content = hex_value + " (END of Msg Ack Message)";
                          }
                          else if (hex_value == 32)
                          {
                              packet_title = "BAM Message";
                              item_content = hex_value + " (BAM Message)";
                          }
                          else if (hex_value == 255)
                          {
                              packet_title = "Abort Message";
                              item_content = hex_value + " (Connection Abort Message)";
                          }
                          else
                          {
                              packet_title = "TP_CM";
                              item_content = hex_value + "(Unknown Group Function Code)";
                          }
                          var first_byte_value = hex_value; //Used to know if it's a RTS/CTS/BAM Message
                          packet_string = item_content;
                          break;
                      }
                      case 1 : // Second byte
                      {
                          if (first_byte_value == 16 || first_byte_value == 19 || first_byte_value == 32)
                          {
                              start_item = can_items[i].start_sample_index;
                              size_low = hex_value;
                              skip_item = true;
                          }
                          else if (first_byte_value == 17)
                          {
                              item_content = "Max packet send at once : " + hex_value;
                          }
                          else if (first_byte_value == 255)
                          {
                              item_content = "Connection abort reason : 0x" + pad(hex_value.toString(16),2);
                          }
                          else
                          {
                              item_content = "0x" + pad(hex_value.toString(16),2);
                          }
                          packet_string = item_content;
                          break;
                      }
                      case 2 : // Third byte
                      {
                          if (first_byte_value == 16 || first_byte_value == 19 || first_byte_value == 32)
                          {
                              can_items[i].start_sample_index = start_item;
                              var size_total = size_low + (hex_value<<8);
                              hex_value = size_total;
                              item_content = "Message size : " + size_total + " bytes";
                          }
                          else if (first_byte_value == 17)
                          {
                              var next_sequence_number = hex_value;
                              item_content = "Next sequence number : " + hex_value;
                          }
                          else if (first_byte_value == 255)
                          {
                              if (hex_value == 255)
                              {
                                  item_content = "Reserved ";
                              }
                              else
                              {
                                  item_content = "0x" + pad(hex_value.toString(16),2) + ", Reserved, should be 0xFF";
                                  types_title = ScanaStudio.PacketColors.Error.Title;
                                  types_content = ScanaStudio.PacketColors.Error.Content;
                              }
                          }
                          else
                          {
                              item_content = "0x" + pad(hex_value.toString(16),2);
                          }
                          packet_string = item_content;
                          break;
                      }
                      case 3 : // Fourth byte
                      {
                          if (first_byte_value == 16) // RTS Message
                          {
                              item_content = hex_value + " Packets";
                               packet_string = "Number of Packets : " + hex_value;
                          }
                          else if (first_byte_value == 19) // End of Msg ACK
                          {
                              item_content = "Total number of packets : " + hex_value;
                              packet_string = item_content;
                          }
                          else if (first_byte_value == 32) // BAM Message
                          {
                              item_content = hex_value + " Packets";
                              packet_string = "Number of Packets : " + hex_value;
                          }
                          else if ((first_byte_value == 255) || (first_byte_value == 17)) // Abort Message
                          {
                              if (hex_value == 255)
                              {
                                  item_content = "Reserved ";
                              }
                              else
                              {
                                  item_content = "0x" + pad(hex_value.toString(16),2) + ", Reserved, should be 0xFF";
                                  types_title = ScanaStudio.PacketColors.Error.Title;
                                  types_content = ScanaStudio.PacketColors.Error.Content;
                              }
                              packet_string = item_content;
                          }
                          else
                          {
                              item_content = "0x" + pad(hex_value.toString(16),2);
                          }
                          break;
                      }
                      case 4 : // Fifth byte
                      {
                          if (first_byte_value == 16) // RTS Message
                          {
                              packet_string = "Packet sent in response : " + hex_value;
                              item_content = "Total number of packet sent in response to CTS : " + hex_value;
                          }
                          else // On this byte every message has reserved bits except RTS
                          {
                              if (hex_value == 255)
                              {
                                  item_content = "Reserved ";
                              }
                              else
                              {
                                  item_content = "0x" + pad(hex_value.toString(16),2) + ", Reserved, should be 0xFF";
                                  types_title = ScanaStudio.PacketColors.Error.Title;
                                  types_content = ScanaStudio.PacketColors.Error.Content;
                              }
                              packet_string = item_content;
                          }
                          break;
                      }
                      case 5 : // Sixth byte
                      {
                          start_item = can_items[i].start_sample_index;
                          skip_item = true;
                          var TP_GPN_low = hex_value;
                          packet_string = item_content;
                          break;
                      }
                      case 6 : // Seventh byte
                      {
                          skip_item = true;
                          var TP_GPN_high = hex_value;
                          packet_string = item_content;
                          break;
                      }
                      case 7 : // Eighth byte
                      {
                          var TP_GPN_data_page = hex_value;
                          if (TP_GPN_high >= 240)
                          {
                              var TP_GPN_total = TP_GPN_low + (TP_GPN_high<<8) + (TP_GPN_data_page<<16);
                          }
                          else
                          {
                              var TP_GPN_total = (TP_GPN_high<<8) + (TP_GPN_data_page<<16);
                          }
                          item_content = "GPN : " + TP_GPN_total + " or 0x" + pad(TP_GPN_total.toString(16),5);
                          hex_value = TP_GPN_total;
                          can_items[i].start_sample_index = start_item;
                          if ((first_byte_value == 17) && (next_sequence_number != 1))
                          {
                              // do nothing
                          }
                          else
                          {
                              byte_nb = 1;
                          }
                          packet_string = item_content;
                          break;
                      }
                  }
              }//end Transport Protocol (BAM/RTS/CTS/Ack/Abort message)
              else if (pgn_total == 60160) // Transport Protocol (Data Transfer)
              {
                  switch (data_nb)
                  {
                      case 0 : // First data byte of the frame
                      {
                          packet_title = "Sequence Number";
                          item_content = hex_value + " (Sequence Number)";
                          packet_string = hex_value;
                          byte_nb = ((hex_value-1)*7) + 1;
                          break;
                      }
                      default : // 1-7
                      {
                          packet_title = "Data byte n°" + byte_nb;
                          if (TP_GPN_total == 65240)
                          {
                              ISO_Commanded_Address(can_items[i]);
                              packet_string = item_content;
                          }
                          else
                          {
                              display_data (hex_value, data_format);
                          }
                          byte_nb ++;
                          packet_string = item_content;
                          break;
                      }
                  }
              }//end Transport Protocol (Data Transfer)
              else if (pgn_total == 59904) // Transport Protocol (REQUEST)
              {
                  switch (data_nb)
                  {
                      case 0 : // First data byte of the frame
                      {
                          var pgn_request_low = hex_value;
                          start_item = can_items[i].start_sample_index;
                          skip_item = true;
                          break;
                      }
                      case 1 : // Second data byte of the frame
                      {
                          var pgn_request_high = hex_value;
                          skip_item = true;
                          break;
                      }
                      case 2 : // Third data byte of the frame
                      {
                          var pgn_request_dp = hex_value;
                          var pgn_request = pgn_request_low + (pgn_request_high<<8) + (pgn_request_dp<<16);
                          can_items[i].start_sample_index = start_item;
                          hex_value = pgn_request;
                          packet_title = "REQUEST PGN";
                          item_content = pgn_request + " (PGN Request)";
                          packet_string = pgn_request + " or 0x" + pad(pgn_request.toString(16),5);
                          break;
                      }
                      default :
                      {
                          packet_title = "Filled Data";
                          if (hex_value != 255)
                          {
                              item_content = "0x" + pad(hex_value.toString(16),2) + ", should be 0xFF";
                              types_title = ScanaStudio.PacketColors.Error.Title;
                              types_content = ScanaStudio.PacketColors.Error.Content;
                          }
                          else
                          {
                              item_content = "Filled with 0xFF";
                          }
                          packet_string = item_content;
                          break;
                      }
                  }
              }//end Transport Protocol (REQUEST)
              else if (fast_packet) // Fast Packet Messages
              {
                  switch (data_nb)
                  {
                      case 0 : // First data byte of the frame
                      {
                          packet_title = "Fast Packet Header";
                          ScanaStudio.dec_item_new(can_items[i].channel_index, can_items[i].start_sample_index, can_items[i].end_sample_index);
                          ScanaStudio.dec_item_add_content("Frame Count : " + hex_value);
                          ScanaStudio.dec_item_add_content(hex_value);
                          ScanaStudio.dec_item_end();
                          // Packet View
                          ScanaStudio.packet_view_add_packet(false,
                              can_items[i].channel_index,
                              can_items[i].start_sample_index,
                              can_items[i].end_sample_index,
                              "Fast Packet Header",
                              (" Frame Count : " + hex_value),
                              ScanaStudio.PacketColors.Data.Title,
                              ScanaStudio.PacketColors.Data.Content);
                          skip_item = true;
                          sequence_counter = hex_value;
                          fast_packet_byte = 6 + (sequence_counter-1)*7;
                          packet_string = item_content;
                          break;
                      }
                      case 1 : // Second data byte of the frame
                      {
                          if (sequence_counter == 0) // PGN Total Byte Number
                          {
                              packet_title = "Data Byte Count";
                              fast_packet_total_byte = hex_value;
                              item_content = hex_value + " Bytes";
                              packet_string = item_content;
                              fast_packet_byte = 0;
                          }
                          else
                          {
                              packet_title = "Fast Packet Data";
                              if (pgn_total == 126208)
                              {
                                  packet_title = "NMEA Data";
                                  NMEA(can_items[i]);
                              }
                              else if (pgn_total == 126983) // Alert
                              {
                                  packet_title = "Alert Data";
                                  alert_byte(can_items[i]);
                              }
                              else if (pgn_total == 126984) // Alert Response
                              {
                                  packet_title = "Alert RSP Data";
                                  alert_response_byte(can_items[i]);
                              }
                              else if (pgn_total == 126985) // Alert Text
                              {
                                  packet_title = "Alert Text Data";
                                  alert_text_byte(can_items[i]);
                              }
                              else if (pgn_total == 126996) //Product_Information
                              {
                                  Product_Information(can_items[i]);
                              }
                              else if (pgn_total == 126998) //Configuration_Information
                              {
                                  Configuration_Information(can_items[i]);
                              }
                              else if (pgn_total == 127233) //Man_Overboard_Notification
                              {
                                  Man_Overboard_Notification(can_items[i]);
                              }
                              else if (pgn_total == 127237) //Heading_Track_control
                              {
                                  Heading_Track_control(can_items[i]);
                              }
                              else if (pgn_total == 127489) //Engine_parameter_Dynamic
                              {
                                  Engine_parameter_Dynamic(can_items[i]);
                              }
                              else if (pgn_total == 127496) //Trip_parameters_Vessel
                              {
                                  Trip_parameters_Vessel(can_items[i]);
                              }
                              else if (pgn_total == 127497) //Trip_parameters_Engine
                              {
                                  Trip_parameters_Engine(can_items[i]);
                              }
                              else if (pgn_total == 127498) //Trip_parameters_Static
                              {
                                  Trip_parameters_Static(can_items[i]);
                              }
                              else if (pgn_total == 127500) //Load_Controller_Connection_State_Control
                              {
                                  Load_Controller_Connection_State_Control(can_items[i]);
                              }
                              else if (pgn_total == 128275) //Distance_Log
                              {
                                  Distance_Log(can_items[i]);
                              }
                              else if (pgn_total == 128520) //Tracked_Target_Data
                              {
                                  Tracked_Target_Data(can_items[i]);
                              }
                              else if (pgn_total == 129038) //AIS_Class_A_Position_Report
                              {
                                  AIS_Class_A_Position_Report(can_items[i]);
                              }
                              else if (pgn_total == 129039) //AIS_Class_B_Position_Report
                              {
                                  AIS_Class_B_Position_Report(can_items[i]);
                              }
                              else if (pgn_total == 129040) //AIS_Class_B_Extended_Position_Report
                              {
                                  AIS_Class_B_Extended_Position_Report(can_items[i]);
                              }
                              else if (pgn_total == 129041) //AIS_Aids_to_Navigation_Report
                              {
                                  AIS_Aids_to_Navigation_Report(can_items[i]);
                              }
                              else if (pgn_total == 129044) //Datum
                              {
                                  Datum(can_items[i]);
                              }
                              else if (pgn_total == 129045) //User_Datum
                              {
                                  User_Datum(can_items[i]);
                              }
                              else if (pgn_total == 129284) //Navigation_Data
                              {
                                  Navigation_Data(can_items[i]);
                              }
                              else if (pgn_total == 129794) //AIS_Class_A_Static_and_Voyage_Related_Data
                              {
                                  AIS_Class_A_Static_and_Voyage_Related_Data(can_items[i]);
                              }
                              else if (pgn_total == 129795) //AIS_Addressed_Binary_Message
                              {
                                  AIS_Addressed_Binary_Message(can_items[i]);
                              }
                              else if (pgn_total == 129796) //AIS_Acknowledge
                              {
                                  AIS_Acknowledge(can_items[i]);
                              }
                              else if (pgn_total == 129797) //AIS_Binary_Broadcast_Message
                              {
                                  AIS_Binary_Broadcast_Message(can_items[i]);
                              }
                              else if (pgn_total == 129809) //AIS_Class_B_static_data_part_A
                              {
                                  AIS_Class_B_static_data_part_A(can_items[i]);
                              }
                              else if (pgn_total == 129810) //AIS_Class_B_static_data_part_B
                              {
                                  AIS_Class_B_static_data_part_B(can_items[i]);
                              }
                              else if (pgn_total == 130320) //Tide_Station_Data
                              {
                                  Tide_Station_Data(can_items[i]);
                              }
                              else if (pgn_total == 130321) //Salinity_Station_Data
                              {
                                  Salinity_Station_Data(can_items[i]);
                              }
                              else if (pgn_total == 130567) //Watermaker_Input_Setting_and_Status
                              {
                                  Watermaker_Input_Setting_and_Status(can_items[i]);
                              }
                              else if (pgn_total == 130578) //Vessel_Speed_Components
                              {
                                  Vessel_Speed_Components(can_items[i]);
                              }
                              // Proprietary Fast Packet
                              else if (pgn_total == 126720 || (pgn_total > 130815 && pgn_total < 130822) || pgn_total == 130824 || pgn_total == 130827 || pgn_total == 130828
                              || pgn_total == 130831 || pgn_total == 130832 || (pgn_total > 130833 && pgn_total < 130841) || (pgn_total > 130841 && pgn_total < 130844) || pgn_total == 130845
                              || pgn_total == 130847 || pgn_total == 130850 || pgn_total == 130851 || pgn_total == 130856 || pgn_total == 130880 || pgn_total == 130881 ||pgn_total == 130944)
                              {
                                  proprietary_fast_packet (can_items[i]);
                              }
                              else
                              {
                                  item_content = "0x" + pad(hex_value.toString(16),2);
                              }
                              packet_string = item_content;
                          }
                          break;
                      }
                      default :
                      {
                          packet_title = "Fast Packet Data";
                          if (pgn_total == 126208)
                          {
                              packet_title = "NMEA Data";
                              NMEA(can_items[i]);
                          }
                          else if (pgn_total == 126983) // Alert
                          {
                              packet_title = "Alert Data";
                              alert_byte(can_items[i]);
                          }
                          else if (pgn_total == 126984) // Alert Response
                          {
                              packet_title = "Alert RSP Data";
                              alert_response_byte(can_items[i]);
                          }
                          else if (pgn_total == 126985) // Alert Text
                          {
                              packet_title = "Alert Text Data";
                              alert_text_byte(can_items[i]);
                          }
                          else if (pgn_total == 126996) //Product_Information
                          {
                              Product_Information(can_items[i]);
                          }
                          else if (pgn_total == 126998) //Configuration_Information
                          {
                              Configuration_Information(can_items[i]);
                          }
                          else if (pgn_total == 127233) //Man_Overboard_Notification
                          {
                              Man_Overboard_Notification(can_items[i]);
                          }
                          else if (pgn_total == 127237) //Heading_Track_control
                          {
                              Heading_Track_control(can_items[i]);
                          }
                          else if (pgn_total == 127489) //Engine_parameter_Dynamic
                          {
                              Engine_parameter_Dynamic(can_items[i]);
                          }
                          else if (pgn_total == 127496) //Trip_parameters_Vessel
                          {
                              Trip_parameters_Vessel(can_items[i]);
                          }
                          else if (pgn_total == 127497) //Trip_parameters_Engine
                          {
                              Trip_parameters_Engine(can_items[i]);
                          }
                          else if (pgn_total == 127498) //Trip_parameters_Static
                          {
                              Trip_parameters_Static(can_items[i]);
                          }
                          else if (pgn_total == 127500) //Load_Controller_Connection_State_Control
                          {
                              Load_Controller_Connection_State_Control(can_items[i]);
                          }
                          else if (pgn_total == 128275) //Distance_Log
                          {
                              Distance_Log(can_items[i]);
                          }
                          else if (pgn_total == 128520) //Tracked_Target_Data
                          {
                              Tracked_Target_Data(can_items[i]);
                          }
                          else if (pgn_total == 129038) //AIS_Class_A_Position_Report
                          {
                              AIS_Class_A_Position_Report(can_items[i]);
                          }
                          else if (pgn_total == 129039) //AIS_Class_B_Position_Report
                          {
                              AIS_Class_B_Position_Report(can_items[i]);
                          }
                          else if (pgn_total == 129040) //AIS_Class_B_Extended_Position_Report
                          {
                              AIS_Class_B_Extended_Position_Report(can_items[i]);
                          }
                          else if (pgn_total == 129041) //AIS_Aids_to_Navigation_Report
                          {
                              AIS_Aids_to_Navigation_Report(can_items[i]);
                          }
                          else if (pgn_total == 129044) //Datum
                          {
                              Datum(can_items[i]);
                          }
                          else if (pgn_total == 129045) //User_Datum
                          {
                              User_Datum(can_items[i]);
                          }
                          else if (pgn_total == 129284) //Navigation_Data
                          {
                              Navigation_Data(can_items[i]);
                          }
                          else if (pgn_total == 129794) //AIS_Class_A_Static_and_Voyage_Related_Data
                          {
                              AIS_Class_A_Static_and_Voyage_Related_Data(can_items[i]);
                          }
                          else if (pgn_total == 129795) //AIS_Addressed_Binary_Message
                          {
                              AIS_Addressed_Binary_Message(can_items[i]);
                          }
                          else if (pgn_total == 129796) //AIS_Acknowledge
                          {
                              AIS_Acknowledge(can_items[i]);
                          }
                          else if (pgn_total == 129797) //AIS_Binary_Broadcast_Message
                          {
                              AIS_Binary_Broadcast_Message(can_items[i]);
                          }
                          else if (pgn_total == 129809) //AIS_Class_B_static_data_part_A
                          {
                              AIS_Class_B_static_data_part_A(can_items[i]);
                          }
                          else if (pgn_total == 129810) //AIS_Class_B_static_data_part_B
                          {
                              AIS_Class_B_static_data_part_B(can_items[i]);
                          }
                          else if (pgn_total == 130320) //Tide_Station_Data
                          {
                              Tide_Station_Data(can_items[i]);
                          }
                          else if (pgn_total == 130321) //Salinity_Station_Data
                          {
                              Salinity_Station_Data(can_items[i]);
                          }
                          else if (pgn_total == 130567) //Watermaker_Input_Setting_and_Status
                          {
                              Watermaker_Input_Setting_and_Status(can_items[i]);
                          }
                          else if (pgn_total == 130578) //Vessel_Speed_Components
                          {
                              Vessel_Speed_Components(can_items[i]);
                          }
                          // Proprietary Fast Packet
                          else if (pgn_total == 126720 || (pgn_total > 130815 && pgn_total < 130822) || pgn_total == 130824 || pgn_total == 130827 || pgn_total == 130828
                          || pgn_total == 130831 || pgn_total == 130832 || (pgn_total > 130833 && pgn_total < 130841) || (pgn_total > 130841 && pgn_total < 130844) || pgn_total == 130845
                          || pgn_total == 130847 || pgn_total == 130850 || pgn_total == 130851 || pgn_total == 130856 || pgn_total == 130880 || pgn_total == 130881 ||pgn_total == 130944)
                          {
                              proprietary_fast_packet (can_items[i]);
                          }
                          else
                          {
                              item_content = "0x" + pad(hex_value.toString(16),2);
                          }
                          packet_string = item_content;
                          break;
                      }
                  }
                  fast_packet_byte++;
              }//end Fast Packets Alert (RSP/Text)
              else // Single Frame Data
              {
                  types_title = ScanaStudio.PacketColors.Data.Title;
                  types_content = ScanaStudio.PacketColors.Data.Content;
                  packet_title = "Data";
                  if (pgn_total == 59392)
                  {
                      ISO_Acknowledgement(can_items[i]);
                  }
                  else if (pgn_total == 60928)
                  {
                      ISO_Adress_Claim(can_items[i]);
                  }
                  else if (pgn_total == 65001 || pgn_total == 65002 || pgn_total == 65003 || pgn_total == 65004)
                  {
                      Bus_Phase(can_items[i]);
                  }
                  else if (pgn_total == 65005 || pgn_total == 65018)
                  {
                      Utility_Total_AC_Energy(can_items[i]);
                  }
                  else if (pgn_total == 65006 || pgn_total == 65009 || pgn_total == 65012 || pgn_total == 65015 || pgn_total == 65019 || pgn_total == 65022 || pgn_total == 65025 || pgn_total == 65028)
                  {
                      Utility_Phase_AC_Reactive_Power(can_items[i]);
                  }
                  else if (pgn_total == 65007 || pgn_total == 65010 || pgn_total == 65013 || pgn_total == 65016 || pgn_total == 65020 || pgn_total == 65023 || pgn_total == 65026 || pgn_total == 65029)
                  {
                      Utility_Phase_AC_Power(can_items[i]);
                  }
                  else if (pgn_total == 65008 || pgn_total == 65011 || pgn_total == 65014 || pgn_total == 65017 || pgn_total == 65021 || pgn_total == 65024 || pgn_total == 65027 || pgn_total == 65030)
                  {
                      Utility_Phase_Basic_AC_Quantities(can_items[i]);
                  }
                  else if (pgn_total == 126992)
                  {
                      System_Time(can_items[i]);
                  }
                  else if (pgn_total == 126993)
                  {
                      Heartbeat(can_items[i]);
                  }
                  else if (pgn_total == 127245)
                  {
                      Rudder(can_items[i]);
                  }
                  else if (pgn_total == 127250)
                  {
                      Vessel_Heading(can_items[i]);
                  }
                  else if (pgn_total == 127251)
                  {
                      Rate_of_Turn(can_items[i]);
                  }
                  else if (pgn_total == 127257)
                  {
                      Attitude(can_items[i]);
                  }
                  else if (pgn_total == 127258)
                  {
                      Magnetic_Variation(can_items[i]);
                  }
                  else if (pgn_total == 127488)
                  {
                      Engine_parameter_Rapid_Update(can_items[i]);
                  }
                  else if (pgn_total == 127493)
                  {
                      Transmission_Parameters_Dynamic(can_items[i]);
                  }
                  else if (pgn_total == 127501)
                  {
                      Binary_Switch_Bank_Status(can_items[i]);
                  }
                  else if (pgn_total == 127502)
                  {
                      Switch_Bank_Control(can_items[i]);
                  }
                  else if (pgn_total == 127505)
                  {
                      Fluid_Level(can_items[i]);
                  }
                  else if (pgn_total == 127507)
                  {
                      Charger_Status(can_items[i]);
                  }
                  else if (pgn_total == 127508)
                  {
                      Battery_Status(can_items[i]);
                  }
                  else if (pgn_total == 127509)
                  {
                      Inverted_Status(can_items[i]);
                  }
                  else if (pgn_total == 128000)
                  {
                      Leeway_Angle(can_items[i]);
                  }
                  else if (pgn_total == 128259)
                  {
                      Speed(can_items[i]);
                  }
                  else if (pgn_total == 128267)
                  {
                      Water_Depth(can_items[i]);
                  }
                  else if (pgn_total == 129025)
                  {
                      Position_Rapid_Update(can_items[i]);
                  }
                  else if (pgn_total == 129026)
                  {
                      COG_SOG_Rapid_Update(can_items[i]);
                  }
                  else if (pgn_total == 129027)
                  {
                      Position_Delta_Rapid_Update(can_items[i]);
                  }
                  else if (pgn_total == 129033)
                  {
                      Time_Date(can_items[i]);
                  }
                  else if (pgn_total == 129283)
                  {
                      Cross_Track_Error(can_items[i]);
                  }
                  else if (pgn_total == 129539)
                  {
                      GNSS_DOPs(can_items[i]);
                  }
                  else if (pgn_total == 130306)
                  {
                      Wind_Data(can_items[i]);
                  }
                  else if (pgn_total == 130310)
                  {
                      Environmental_Parameters(can_items[i]);
                  }
                  else if (pgn_total == 130311)
                  {
                      Environmental_Parameters_2(can_items[i]);
                  }
                  else if (pgn_total == 130312)
                  {
                      Temperature(can_items[i]);
                  }
                  else if (pgn_total == 130313)
                  {
                      Humidity(can_items[i]);
                  }
                  else if (pgn_total == 130314 || pgn_total == 130315) // Actual Pressure and Set Pressure
                  {
                      Actual_Pressure(can_items[i]);
                  }
                  else if (pgn_total == 130316)
                  {
                      Temperature_Extended_Range(can_items[i]);
                  }
                  else if (pgn_total == 61184 || pgn_total == 61440 || pgn_total == 65280 || pgn_total == 65284 || pgn_total == 65285 || pgn_total == 65286 || pgn_total == 65287
                    || pgn_total == 65288 || pgn_total == 65289 || pgn_total == 65290 || pgn_total == 65292 || pgn_total == 65293 || pgn_total == 65309 || pgn_total == 65312
                    || pgn_total == 65325 || pgn_total == 65341 || pgn_total == 65345 || pgn_total == 65359 || pgn_total == 65360 || pgn_total == 65361 || pgn_total == 65371
                    || pgn_total == 65374 || pgn_total == 65379 || pgn_total == 65408|| pgn_total == 65409 || pgn_total ==65410|| pgn_total == 65480 || pgn_total == 130824)
                  {
                      proprietary_single_frame(can_items[i]);
                  }
                  else
                  {
                      if (hex_value == 0xFF)
                      {
                          packet_title = "Data";
                          display_data (hex_value, data_format);
                          types_title = ScanaStudio.PacketColors.Data.Title;
                          types_content = ScanaStudio.PacketColors.Data.Content;
                      }
                      else if (hex_value == 0xFE)
                      {
                          packet_title = "Data";
                          item_content = "0x" + pad(hex_value.toString(16),2) + " (Error)";
                          types_title = ScanaStudio.PacketColors.Error.Title;
                          types_content = ScanaStudio.PacketColors.Error.Content;
                      }
                      else
                      {
                          display_data (hex_value, data_format);
                      }
                  }
                  packet_string = item_content;
              }//end Single Frame Data

              if (skip_item == false)
              {
                  ScanaStudio.dec_item_new(can_items[i].channel_index, can_items[i].start_sample_index,can_items[i].end_sample_index);
                  if (data_format == 0) // Hexa
                  {
                      if ((can_items[i].end_sample_index - can_items[i].start_sample_index) < 10*samples_per_bit_std)
                      {
                          var display = ["DATA = " + item_content, "DATA = 0x" + pad(hex_value.toString(16),2), item_content, "0x" + pad(hex_value.toString(16),2)];
                      }
                      else
                      {
                          var display = ["DATA = " + item_content, "DATA = 0x" + pad(hex_value.toString(16),5), item_content, "0x" + pad(hex_value.toString(16),5)];
                      }
                  }
                  else if (data_format == 1) // Binaire
                  {
                      if ((can_items[i].end_sample_index - can_items[i].start_sample_index) < 10*samples_per_bit_std)
                      {
                          var display = ["DATA = " + item_content, "DATA = 0b" + pad(hex_value.toString(2),8), item_content, "0b" + pad(hex_value.toString(2),17)];
                      }
                      else
                      {
                          var display = ["DATA = " + item_content, "DATA = 0b" + pad(hex_value.toString(2),17), item_content, "0b" + pad(hex_value.toString(2),17)];
                      }
                  }
                  else // Decimal
                  {
                      var display = ["DATA = " + item_content, "DATA = " + hex_value, item_content, hex_value];
                  }
                  display.sort();
                  ScanaStudio.dec_item_add_content(display[3]);
                  ScanaStudio.dec_item_add_content(display[2]);
                  ScanaStudio.dec_item_add_content(display[1]);
                  ScanaStudio.dec_item_add_content(display[0]);
                  ScanaStudio.dec_item_end();
                  // Packet View
                  ScanaStudio.packet_view_add_packet(false,
                      can_items[i].channel_index,
                      can_items[i].start_sample_index,
                      can_items[i].end_sample_index,
                      packet_title,
                      packet_string,
                      types_title,
                      types_content);
              }
              else
              {
                 skip_item = false;
              }
              data_nb ++; // data_nb represent the byte number (0-7)
          }//end if (can_items[i].content.search("DATA") != -1)
          // Create packet view for CRC
          else if (can_items[i].content.search("CRC =") != -1)
          {
              hex_value = get_hex_value(can_items[i].content, crc_format);
              ScanaStudio.dec_item_new(can_items[i].channel_index,can_items[i].start_sample_index + 1, can_items[i].end_sample_index);
              ScanaStudio.dec_item_add_content(can_items[i].content);
              if (data_format == 0) // Hexa
              {
                  ScanaStudio.dec_item_add_content("0x" + pad(hex_value.toString(16),4));
              }
              else if (data_format == 1) // Binaire
              {
                  ScanaStudio.dec_item_add_content("0b" + pad(hex_value.toString(2),15));
              }
              else
              {
                  ScanaStudio.dec_item_add_content(hex_value);
              }
              types_title = ScanaStudio.PacketColors.Check.Title;
              types_content = ScanaStudio.PacketColors.Check.Content;
              if (can_items[i].content.search("should") != -1) // if the CRC is incorrect
              {
                  ScanaStudio.dec_item_emphasize_warning();
                  types_title = ScanaStudio.PacketColors.Error.Title;
                  types_content = ScanaStudio.PacketColors.Error.Content;
              }
              ScanaStudio.dec_item_end();
              // Packet View
              ScanaStudio.packet_view_add_packet(false,
                  can_items[i].channel_index,
                  can_items[i].start_sample_index,
                  can_items[i].end_sample_index,
                  "CRC",
                  can_items[i].content,
                  types_title,
                  types_content);
          }//end CRC
          // Create packet view if there is CRC Delimiter error
          else if (can_items[i].content.search("CRC Delimiter missing") != -1)
          {
              ScanaStudio.dec_item_new(can_items[i].channel_index,can_items[i].start_sample_index + 1, can_items[i].end_sample_index);
              ScanaStudio.dec_item_add_content(can_items[i].content);
              ScanaStudio.dec_item_add_content("CRC Del");
              ScanaStudio.dec_item_emphasize_warning();
              types_title = ScanaStudio.PacketColors.Error.Title;
              types_content = ScanaStudio.PacketColors.Error.Content;
              ScanaStudio.dec_item_end();
              // Packet View
              ScanaStudio.packet_view_add_packet(false,
                  can_items[i].channel_index,
                  can_items[i].start_sample_index,
                  can_items[i].end_sample_index,
                  "CRC Delimiter",
                  can_items[i].content,
                  types_title,
                  types_content);
          }//end CRC Delimiter
          // Create packet view for ACK
          else if ((can_items[i].content.search("Acknowledge") != -1) && (can_items[i].content.search("Delimiter") == -1))
          {
              ScanaStudio.dec_item_new(can_items[i].channel_index,can_items[i].start_sample_index + 1, can_items[i].end_sample_index);
              ScanaStudio.dec_item_add_content(can_items[i].content);
              ScanaStudio.dec_item_add_content("Ack");
              types_title = ScanaStudio.PacketColors.Check.Title;
              types_content = ScanaStudio.PacketColors.Check.Content;
              packet_title = "ACK";
              if (can_items[i].content.search("No") != -1) // if there is no ack
              {
                  packet_title = "NACK";
                  ScanaStudio.dec_item_emphasize_warning();
                  types_title = ScanaStudio.PacketColors.Error.Title;
                  types_content = ScanaStudio.PacketColors.Error.Content;
              }
              ScanaStudio.dec_item_end();
              // Packet View
              ScanaStudio.packet_view_add_packet(false,
                  can_items[i].channel_index,
                  can_items[i].start_sample_index,
                  can_items[i].end_sample_index,
                  packet_title,
                  can_items[i].content,
                  types_title,
                  types_content);
          }//end Ack
          // Create packet view if there is ACK Delimiter error
          else if (can_items[i].content.search("ACK Delimiter missing") != -1)
          {
              ScanaStudio.dec_item_new(can_items[i].channel_index,can_items[i].start_sample_index + 1, can_items[i].end_sample_index);
              ScanaStudio.dec_item_add_content(can_items[i].content);
              ScanaStudio.dec_item_add_content("Ack Del");
              ScanaStudio.dec_item_emphasize_warning();
              types_title = ScanaStudio.PacketColors.Error.Title;
              types_content = ScanaStudio.PacketColors.Error.Content;
              ScanaStudio.dec_item_end();
              // Packet View
              ScanaStudio.packet_view_add_packet(false,
                  can_items[i].channel_index,
                  can_items[i].start_sample_index,
                  can_items[i].end_sample_index,
                  "ACK Delimiter",
                  can_items[i].content,
                  types_title,
                  types_content);
          }//end Ack Delimiter
          // Create packet view for EOF
          else if (can_items[i].content.search("End") != -1)
          {
              ScanaStudio.dec_item_new(can_items[i].channel_index,can_items[i].start_sample_index + 1, can_items[i].end_sample_index);
              ScanaStudio.dec_item_add_content(can_items[i].content);
              ScanaStudio.dec_item_add_content("EOF");
              types_title = ScanaStudio.PacketColors.Wrap.Title;
              types_content = ScanaStudio.PacketColors.Wrap.Content;
              packet_title = "EOF";
              if (can_items[i].content.search("No") != -1) // if there is no ack
              {
                  packet_title = "EOF missing";
                  ScanaStudio.dec_item_emphasize_warning();
                  types_title = ScanaStudio.PacketColors.Error.Title;
                  types_content = ScanaStudio.PacketColors.Error.Content;
              }
              ScanaStudio.dec_item_end();
              // Packet View
              ScanaStudio.packet_view_add_packet(false,
                  can_items[i].channel_index,
                  can_items[i].start_sample_index,
                  can_items[i].end_sample_index,
                  packet_title,
                  can_items[i].content,
                  types_title,
                  types_content);
          }//end "End"
          // Create a packet view for Stuffing Errors
          else if (can_items[i].content.search("Stuffing error") != -1)
          {
              ScanaStudio.dec_item_new(can_items[i].channel_index,can_items[i].start_sample_index + 1, can_items[i].end_sample_index);
              ScanaStudio.dec_item_add_content(can_items[i].content);
              ScanaStudio.dec_item_emphasize_error();
              types_title = ScanaStudio.PacketColors.Error.Title;
              types_content = ScanaStudio.PacketColors.Error.Content;
              ScanaStudio.dec_item_end();
              // Packet View
              ScanaStudio.packet_view_add_packet(true,
                  can_items[i].channel_index,
                  can_items[i].start_sample_index,
                  can_items[i].end_sample_index,
                  "Error",
                  can_items[i].content,
                  types_title,
                  types_content);
          }//end Stuffing Error
          // Copy the CAN dec_items for the others
          else
          {
              ScanaStudio.dec_item_new(can_items[i].channel_index, can_items[i].start_sample_index,can_items[i].end_sample_index);
              ScanaStudio.dec_item_add_content(can_items[i].content);
              ScanaStudio.dec_item_end();
          }//end other CAN items
      }//end for (i=0; i < can_items.length; i++)
  }//end if (!resume)
}//end on_decode_signals


//Trigger sequence GUI
function on_draw_gui_trigger()
{
  ScanaStudio.gui_add_info_label("Trigger on specific NMEA_2000 frame. Type hex values (e.g. 0xAB1122) or decimal value (e.g. ‭11211042‬)");

  ScanaStudio.gui_add_new_selectable_containers_group("trg_alt","Trigger alternative");
  ScanaStudio.gui_add_new_container("Full ID ",true);
  ScanaStudio.gui_add_text_input("nmea_full_id","Extended ID","0x1DF01023");
  ScanaStudio.gui_end_container();
  ScanaStudio.gui_add_new_container("Full ID (fill field)",false);
  ScanaStudio.gui_add_text_input("nmea_priority_trig","Priority","0x2");
  ScanaStudio.gui_add_text_input("nmea_edp_trig","EDP (Extended Data Page)","0x0");
  ScanaStudio.gui_add_text_input("nmea_dp_trig","DP (Data Page)","0x1");
  ScanaStudio.gui_add_text_input("nmea_pf_trig","PF (PGN High)","0xFF");
  ScanaStudio.gui_add_text_input("nmea_ps_trig","PS (PGN Low)","0x56");
  ScanaStudio.gui_add_text_input("nmea_sa_trig","SA (Source Adress)","0x76");
  ScanaStudio.gui_end_container();
  ScanaStudio.gui_end_selectable_containers_group();

  ScanaStudio.gui_add_new_tab("Data bytes", false);
    ScanaStudio.gui_add_info_label("Data bytes are optionnal. Leave it empty if you don't wish to trigger on specific data bytes. Bytes must be written in the same order as they will appear on the CAN frame. You can either type in hexadecimal, decimal, or a mix of both. byte should be separated by a comma, e.g.: 0xA1,0xA2,0xA3");
    ScanaStudio.gui_add_text_input("can_trig_data","Data bytes","");
  ScanaStudio.gui_end_tab();
}

//Evaluate trigger GUI
function on_eval_gui_trigger()
{
    var trg_alt = ScanaStudio.gui_get_value("trg_alt");
    var nmea_full_id = ScanaStudio.gui_get_value("nmea_full_id");
    var nmea_priority_trig = ScanaStudio.gui_get_value("nmea_priority_trig");
    var nmea_dp_trig = ScanaStudio.gui_get_value("nmea_dp_trig");
    var nmea_edp_trig = ScanaStudio.gui_get_value("nmea_edp_trig");
    var nmea_pf_trig = ScanaStudio.gui_get_value("nmea_pf_trig");
    var nmea_ps_trig = ScanaStudio.gui_get_value("nmea_ps_trig");
    var nmea_sa_trig = ScanaStudio.gui_get_value("nmea_sa_trig");

  if (trg_alt == 0)
  {
      if(isNaN(nmea_full_id))
      {
          return "Invalid ID (not a number)";
      }
      else if(nmea_full_id > 0x1FFFFFFF)
      {
          return "Invalid ID (more than 29 bits)";
      }
  }
  if (trg_alt == 1)
  {
      if(isNaN(nmea_priority_trig))
      {
          return "Invalid Message Priority (not a number)";
      }
      else if(nmea_priority_trig > 0x7)
      {
          return "Invalid Message Priority (more than 3 bits)";
      }
      //
      if(isNaN(nmea_dp_trig))
      {
          return "Invalid Data Page (not a number)";
      }
      else if(nmea_dp_trig > 0x1)
      {
          return "Invalid Data Page (more than 1 bit)";
      }

      if(isNaN(nmea_edp_trig))
      {
          return "Invalid Extended Data Page (not a number)";
      }
      else if(nmea_edp_trig > 0x1)
      {
          return "Invalid Extended Data Page (more than 1 bit)";
      }

      if(isNaN(nmea_pf_trig))
      {
          return "Invalid PF (not a number)";
      }
      else if(nmea_pf_trig > 0xFF)
      {
          return "Invalid PF (more than 8 bits)";
      }

      if(isNaN(nmea_ps_trig))
      {
          return "Invalid PS (not a number)";
      }
      else if(nmea_ps_trig > 0xFF)
      {
          return "Invalid PS (more than 8 bits)";
      }

      if(isNaN(nmea_sa_trig))
      {
          return "Invalid SA (not a number)";
      }
      else if(nmea_sa_trig > 0xFF)
      {
          return "Invalid SA (more than 8 bits)";
      }
  }

  return ""; //All good.
}

//Build trigger sequence
function on_build_trigger()
{
  var trg_alt = Number(ScanaStudio.gui_get_value("trg_alt"));
  var nmea_priority_trig = Number(ScanaStudio.gui_get_value("nmea_priority_trig"));
  var nmea_dp_trig = Number(ScanaStudio.gui_get_value("nmea_dp_trig"));
  var nmea_edp_trig = Number(ScanaStudio.gui_get_value("nmea_edp_trig"));
  var nmea_pf_trig = Number(ScanaStudio.gui_get_value("nmea_pf_trig"));
  var nmea_ps_trig = Number(ScanaStudio.gui_get_value("nmea_ps_trig"));
  var nmea_sa_trig = Number(ScanaStudio.gui_get_value("nmea_sa_trig"));
  var nmea_full_id = 0;
  var data_string = ScanaStudio.gui_get_value("can_trig_data");
  var data_array = data_string.split(',');
  var number_array = [];
  var trg = TriggerObject;

  trg.configure(ScanaStudio.gui_get_value("ch"),
                ScanaStudio.gui_get_value("rate"),
                ScanaStudio.get_capture_sample_rate());
  var tmp;
  for (i = 0; i < data_array.length; i++)
  {
      tmp = Number(data_array[i].trim());
      if(!isNaN(tmp) && (data_string.length != 0))
      {
        number_array.push(tmp);
      }
  }
  if (trg_alt == 0)
  {
     nmea_full_id = Number(ScanaStudio.gui_get_value("nmea_full_id"));
  }
  else
  {
      nmea_full_id = nmea_sa_trig + (nmea_ps_trig<<8) + (nmea_pf_trig<<16) + (nmea_dp_trig<<24) + (nmea_edp_trig<<25) + (nmea_priority_trig<<26);
  }
  trg.build_trg_ext(nmea_full_id, number_array);
  ScanaStudio.flexitrig_print_steps();
}//end on_build_trigger

TriggerObject = {
	build_trg_std : function(id,data_array)
  {
    stuffing_reset();
    this.put_trig_wait_start();
    this.put_word(id,11);
    if (data_array.length > 0)
    {
        this.put_bit(0); //RTR
        this.put_bit(0); //IDE = 0
        this.put_bit(0); //R0 //Always 0 for CAN frame (1 for CAN FD frames)
        this.put_word(data_array.length,4);
        for (i = 0; i < data_array.length; i++)
        {
          this.put_word(data_array[i],8);
        }
    }
    this.put_trig_end();
  },
  build_trg_ext : function(id,data_array)
  {
    stuffing_reset();
    this.put_trig_wait_start();
    this.put_word((id >> 18),11);
    this.put_bit(1); //SRR
    this.put_bit(1); //IDE = 1
    this.put_word((id) & 0x3FFFF,18);
    if (data_array.length > 0)
    {
        this.put_bit(0); //RTR
        this.put_bit(0); //R1
        this.put_bit(0); //R0 //Always 0 for CAN frame (1 for CAN FD frames)
        this.put_word(data_array.length,4);
        for (i = 0; i < data_array.length; i++)
        {
          this.put_word(data_array[i],8);
        }
    }
    this.put_trig_end();
  },
  build_trg_pgn : function(pgn,data_array)
  {
      stuffing_reset();
      this.put_trig_wait_start();
      this.put_word(pgn)
    tis.put_trig_end();
  },
  put_word : function(words,len)
  {
    var i;
    for (i = (len-1); i >= 0; i--)
    {
      this.put_bit((words >> i) & 0x1);
    }
  },
  put_bit : function(b)
  {
    var sb = -1; //assume there is not bit stuffing
    sb = stuffing_build(b);
    if (sb >= 0) //add stuffed bit if needed
    {
      this.put_trig_step(sb);
    }
    this.put_trig_step(b);
  },
  put_trig_wait_start : function()
  {
    var step_idle = "";
    var i;

    for (i = 0; i < ScanaStudio.get_device_channels_count(); i++)
    {
        if (i == this.channel)
        {
            step_idle = "F" + step_idle;
        }
        else
        {
            step_idle = "X" + step_idle;
        }
    }
    ScanaStudio.flexitrig_append(step_idle,-1,-1);
    this.last_level = 0;
    this.bits_count = 1;
  },
  put_trig_step : function(b)
  {
    var step = "";
    var i;
    var step_ch_desc;

    if (b == this.last_level)
    {
      this.bits_count++;
      return;
    }

    if (b == 0)
    {
        step_ch_desc = "F";
    }
    else
    {
        step_ch_desc = "R";
    }
    for (i = 0; i < ScanaStudio.get_device_channels_count(); i++)
    {
        if (i == this.channel)
        {
            step = step_ch_desc + step;
        }
        else
        {
            step = "X" + step;
        }
    }
    if (this.bits_count > 6) //in case of the start bit, no t_max constraint
    {
      //15% slack
      ScanaStudio.flexitrig_append(step,this.bits_count * this.bit_period * 0.85,-1);
    }
    else
    {
      //15% slack
      ScanaStudio.flexitrig_append(step,this.bits_count * this.bit_period * 0.85,this.bits_count * this.bit_period * 1.15);
    }
    this.last_level = b;
    this.bits_count = 1;
  },
  /*
  put_trig_end is used to add the very final trigger
  step, which is different than intermediary steps.
  The final step has only a "t_min" constrain,
  */
  put_trig_end : function()
  {
    var step_next = "";
    var i;
    var step

    if (this.last_level == 1)
    {
      step = "F";
    }
    else
    {
      step = "R";
    }

    for (i = 0; i < ScanaStudio.get_device_channels_count(); i++)
    {
      if (i == this.channel)
      {
        step_next = step + step_next;
      }
      else
      {
        step_next = "X" + step_next;
      }
    }
    ScanaStudio.flexitrig_append(step_next,this.bits_count * this.bit_period * 0.85,-1);
  },
  configure : function(channel,bitrate_std,sample_rate)
  {
    this.channel = channel;
    this.last_level;
    this.bits_count;
    this.bit_period = 1/bitrate_std;
  }
};//end TriggerObject


//Function called to generate demo siganls (when no physical device is attached)
function on_build_demo_signals()
{
    //Use the function below to get the number of samples to be built
    var samples_to_build = ScanaStudio.builder_get_maximum_samples_count();
    sampling_rate = ScanaStudio.get_capture_sample_rate();
    var silence_period_samples = 1000 + (samples_to_build / 125);
    var builder = ScanaStudio.load_builder_object("can.js");
    ch = ScanaStudio.gui_get_value("ch");
    rate = ScanaStudio.gui_get_value("rate");
    rate_fd = ScanaStudio.gui_get_value("rate_fd");
    can_fd_iso = ScanaStudio.gui_get_value("can_fd_iso");
    builder.configure(ch,rate,rate_fd,sampling_rate,can_fd_iso);

    var nmea_builder = ScanaStudio.BuilderObject;
    nmea_builder.config(builder);

    builder.put_silence(500e3);
    var demo_pgn = 0;

    var data = build_sample_data(8);
    nmea_builder.put_single_frame (0,(61440>>16),(61440>>8)&0xFF, (61440&0xFF), 45, data);
    builder.put_silence(100e3);
    // 10 random Fast Packet frame
    for (f=0; f<10; f++)
    {
        while (fast_packet_total_byte == -1 || fast_packet_total_byte > 45)
        {
            demo_pgn = Math.floor((Math.random()*0x1FFFF));
            get_fast_packet_total_byte(demo_pgn);
        }
        var rng_priority = Math.floor(Math.random()*7.9);
        var rng_sa = Math.floor(Math.random()*255.9);
        nmea_builder.put_fast_packet(rng_priority, demo_pgn, rng_sa, fast_packet_total_byte);
        builder.put_silence(100e3);
        fast_packet_total_byte = -1;
    }
    demo_pgn = Math.floor((Math.random()*0x1FFFF));
    get_pgn_name(demo_pgn);
    is_fast_packet(demo_pgn);
    // 10 random Single frame
    for (i=0; i<10; i++)
    {
        while ((pgn_name == "UNKNOWN PGN NAME AND DATA FIELDS") || (fast_packet == true))
        {
            demo_pgn = Math.floor((Math.random()*0x1FFFF));
            get_pgn_name(demo_pgn);
            is_fast_packet(demo_pgn);
        }
        var rng_priority = Math.floor(Math.random()*7.9);
        var rng_sa = Math.floor(Math.random()*255.9);
        var data = build_sample_data(8);
        nmea_builder.put_single_frame(rng_priority, ((demo_pgn>>16)&0x1),((demo_pgn>>8)&0xFF), (demo_pgn&0xFF), rng_sa, data);
        builder.put_silence(100e3);
        pgn_name = "UNKNOWN PGN NAME AND DATA FIELDS";
    }
    // ISO11783  BAM Multi Packet
    nmea_builder.put_bam_multi_packet(0, 65, 9, 65240);
    // Alert
    nmea_builder.put_fast_packet(2, 0x1F007, 54, 28);
    // Alert RSP
    nmea_builder.put_fast_packet(2, 0x1F008, 54, 25);
    // Alert Text
    nmea_builder.put_fast_packet(2, 0x1F009, 54, 49);

    while (ScanaStudio.builder_get_samples_acc(ch) < samples_to_build)
    {
      random_frame_type = Math.floor(Math.random()*3.9);
      switch (random_frame_type)
      {
        case 1:
        var rng_priority = Math.floor(Math.random()*7.9);
        var rng_sa = Math.floor(Math.random()*255.9);
        var rng_byte = Math.floor(Math.random()*60);
        var rng_pgn = Math.floor(Math.random()*0x1FFFF);
        nmea_builder.put_bam_multi_packet(rng_priority,rng_sa,rng_byte,rng_pgn);
          break;
        case 2:
        var rng_priority = Math.floor(Math.random()*7.9);
        var rng_ps = Math.floor(Math.random()*254.9);
        var rng_sa = Math.floor(Math.random()*255.9);
        var rng_byte = Math.floor(Math.random()*60); // In theory we can go to 1785 bytes but for the demo we fixed to 60
        var rng_pgn = Math.floor(Math.random()*0x1FFFF);
        nmea_builder.put_not_bam_multi_packet(rng_priority, rng_ps, rng_sa, rng_byte, rng_pgn);
        break;
        case 3:
        var rng_pgn = Math.floor((Math.random()*0x1FFFF));
        is_fast_packet(rng_pgn);
        while (fast_packet == true)
        {
            var rng_pgn = Math.floor((Math.random()*0x1FFFF));
            is_fast_packet(rng_pgn);
        }
        var rng_priority = Math.floor(Math.random()*7.9);
        var rng_sa = Math.floor(Math.random()*255.9);
        var data = build_sample_data(8);
        nmea_builder.put_single_frame(rng_priority, ((demo_pgn>>16)&0x1),((demo_pgn>>8)&0xFF), (demo_pgn&0xFF), rng_sa, data);
        break;
        default:
        random_id = Math.floor(Math.random()*(Math.pow(2,29)));
        sample_data = build_sample_data(8);
        builder.put_can_ext_frame(random_id,sample_data);
      }
      builder.put_silence(300e3);
    }
}//end on_build_demo_signals()

function push_data(data, data_2)
{
    for (i=0; i< data_2.length; i++)
    {
        data.push(data_2[i]);
    }
}

function build_sample_data(len)
{
    sample_data = [];
    var i = 0;
    for (i = 0; i < len; i++)
    {
      sample_data.push(Math.floor(Math.random()*0xFF));
    }
    return sample_data;
}

//Builder object that can be shared to other scripts
ScanaStudio.BuilderObject =
{
    config : function(can_builder)
    {
        this.can_builder = can_builder;
    },

    put_single_frame : function (priority, dp, pf, ps, sa, data)
    {
        var id = (priority<<26) + (dp<<24) + (pf<<16) + (ps<<8) + sa;
        while (data.length < 8)
        {
            data.push(0xff);
        }
        this.can_builder.put_can_ext_frame(id, data);
    },

    put_fast_packet : function (priority, pgn, sa, nb_bytes)
    {
        //Create the ID
        var id = (priority<<26) + (pgn<<8) + sa;
        var data = [0, nb_bytes];
        data_2 = build_sample_data(6);
        push_data(data, data_2);
        this.can_builder.put_can_ext_frame(id, data);
        this.can_builder.put_silence(100e3); // the value is random
        var nb_packet = 1 + Math.ceil((nb_bytes-6)/7);
        var bytes_counter = 6;
        var nb_bytes_total = nb_bytes;
        var pgn_ps = pgn&0xff;
        var pgn_pf = (pgn>>8)&0xff;
        var pgn_dp = (pgn>>16)&0x1;
        for (p=1; p<nb_packet; p++)
        {
            data = [p];
            if ((nb_bytes_total - bytes_counter) < 7)
            {
                built_data = build_sample_data(nb_bytes_total - bytes_counter);
            }
            else
            {
                built_data = build_sample_data(7);
            }
            push_data(data, built_data);
            this.put_single_frame(priority, pgn_dp, pgn_pf, pgn_ps, sa, data);
            this.can_builder.put_silence(100e3);
            bytes_counter += 7;
        }

    },

    put_bam_multi_packet : function (priority, sa, nb_bytes, pgn)
    //P: Message priority. Must come first.                             3 bits
    //EDP: Extended data page. J1939 devices must set to 0.             1bit (0)
    //DP: Data page. Used to create a second page of PGNs.              1 bit
    // PF: PDU format:                                                  8bits
    // < 240, PS is destination address. (PDU1 format)
    // >= 240, PS is group extension. (PDU2 format)
    // PS: PDU specific. Either destination address or group extension. 8 bits
    // SA: Source address of controller application (CA).               8bits
    {
        // DP and PF are fixed because the multi packet has a specific PGN
        var pf = 0xEC;
        var dp = 0x00;
        var ps = 255;
        // BAM_TP_CM (Transfert Protocol Connection Manager)
        var id = (priority<<26) + (dp<<24) + (pf<<16) + (ps<<8) + sa;
        var nb_bytes_low = (nb_bytes)&0xff;
        var nb_bytes_high = (nb_bytes>>8)&0xFF;
        var nb_packet = Math.ceil(nb_bytes/7);
        var pgn_ps = pgn&0xff;
        var pgn_pf = (pgn>>8)&0xff;
        var pgn_dp = (pgn>>16)&0x1;
        var data = [32, nb_bytes_low, nb_bytes_high, nb_packet, 255, pgn_ps, pgn_pf, pgn_dp];
        this.can_builder.put_can_ext_frame(id, data);

        // TP_DT (Transfert Protocol Data Transfer)
        var packet_nb = 1;
        var byte_nb = 0;
        var pf = 0xEB;
        var id = (priority<<26) + (dp<<24) + (pf<<16) + (ps<<8) + sa;
        for (k=0; k<nb_packet; k++)
        {
            sample_data = build_sample_data(7);
            data = [packet_nb];
            packet_nb ++;
            for (i=0; i<sample_data.length; i++)
            {
                if (byte_nb >= nb_bytes)
                {
                    data.push(0xFF);
                }
                else
                {
                    data.push(sample_data[i]);
                }
                byte_nb ++;
            }
            var rng_silence = 50 + Math.floor(Math.random()*150); // between 50ms and 200ms
            this.can_builder.put_silence(sampling_rate/1000*rng_silence);
            this.can_builder.put_can_ext_frame(id, data);
        }
    },

    put_not_bam_multi_packet : function (priority, ps, sa, nb_bytes, pgn)
    {
        // REQUEST
        // DP and PF are fixed because the multi packet has a specific PGN
        var pf = 0xEA;
        var dp = 0x00;
        // Request_TP_CM (Transfert Protocol Connection Manager)
        var id = (priority<<26) + (dp<<24) + (pf<<16) + (ps<<8) + sa;
        var pgn_ps = pgn&0xff;
        var pgn_pf = (pgn>>8)&0xff;
        var pgn_dp = (pgn>>16)&0x1;
        var data = [pgn_pf, pgn_ps, pgn_dp, 255, 255, 255, 255, 255];
        this.can_builder.put_can_ext_frame(id, data);

        // DP and PF are fixed because the multi packet has a specific PGN
        this.can_builder.put_silence(sampling_rate/20);
        var pf = 0xEC;
        var dp = 0x00;
        // RTS_TP_CM (Transfert Protocol Connection Manager)
        var id = (priority<<26) + (dp<<24) + (pf<<16) + (sa<<8) + ps;
        var nb_bytes_low = (nb_bytes)&0xff;
        var nb_bytes_high = (nb_bytes>>8)&0xFF;
        var nb_packet = Math.ceil(nb_bytes/7);
        var pgn_pf = pgn&0xff;
        var pgn_ps = (pgn>>8)&0xff;
        var pgn_dp = (pgn>>16)&0x1;
        if (nb_packet < 5)
        {
            var total_packet_sent = nb_packet;
        }
        else
        {
            var total_packet_sent = 5;
        }
        var data = [16, nb_bytes_low, nb_bytes_high, nb_packet, total_packet_sent, pgn_pf, pgn_ps, pgn_dp];
        this.can_builder.put_can_ext_frame(id, data);

        // DP and PF are fixed because the multi packet has a specific PGN
        this.can_builder.put_silence(sampling_rate/20);
        var pf = 0xEC;
        var dp = 0x00;
        var nb_sequence = 1;
        var send_packet = 4; // We fixed it but we could also put it in argument of the function
        if (nb_packet < 4)
        {
            send_packet = nb_packet;
        }
        var byte_nb = 0;

        var id = (priority<<26) + (dp<<24) + (pf<<16) + (ps<<8) + sa;
        pf = 0xEB;
        var transfer_id = (priority<<26) + (dp<<24) + (pf<<16) + (sa<<8) + ps;
        // TP_DT (Transport Protocol Data Transfer)
        while (nb_packet >= nb_sequence)
        {
            // CTS_TP_CM (Transport Protocol Connection Manager)
            var data = [17, send_packet, nb_sequence, 255, 255, pgn_pf, pgn_ps, pgn_dp];
            this.can_builder.put_can_ext_frame(id, data);
            this.can_builder.put_silence(sampling_rate/20);

            // TP_DT (Transport Protocol Data Transfer)
            for (k=0; k<send_packet; k++)
            {
                if (nb_sequence > nb_packet)
                {
                    break;
                }
                sample_data = build_sample_data(7);
                data = [nb_sequence];
                for (i=0; i<sample_data.length; i++)
                {
                    if (byte_nb >= nb_bytes)
                    {
                        data.push(0xFF);
                    }
                    else
                    {
                        data.push(sample_data[i]);
                        byte_nb ++;
                    }
                }
                this.can_builder.put_can_ext_frame(transfer_id, data);
                var rng_silence = Math.floor(Math.random()*200); // Between 0 and 200ms
                this.can_builder.put_silence(sampling_rate/1000*rng_silence);
                nb_sequence++;
            }
        }
        // ACK_TP_CM (Transport Protocol Connection Manager)
        byte_nb_low = byte_nb&0xFF;
        byte_nb_high = (byte_nb>>8)&0xFF;
        pf = 0xEC;
        var id = (priority<<26) + (dp<<24) + (pf<<16) + (ps<<8) + sa;
        var data = [19, byte_nb_low, byte_nb_high, nb_sequence - 1, 255, pgn_pf, pgn_ps, pgn_dp];
        this.can_builder.put_can_ext_frame(id, data);

    },
};//end BuilderObject


//------------------------------------------------------------------------------------------------------------------------------------------//
//                                                       CAN Usefull Functions                                                              //
//------------------------------------------------------------------------------------------------------------------------------------------//

/**
Check if next bit should be a stuffed bit.
returns the stuffed bit value (0 or 1) if a suffed bit is needed
returns -1 if no bit stuff is needed
*/
var stuff_counter = 0;
var stuffed_bit_counter = 0;
var stuff_crc_counter = 0;
var stuff_last_bit;
var stuff_first_crc_bit = true;
function stuffing_build(b)
{
  var ret = -1;

  if (stuff_counter >= 5)
  {
    ret =  (!stuff_last_bit) & 0x1;
    stuffed_bit_counter++;
    stuff_counter = 1;
    if (ret == b)
    {
      stuff_counter++;
    }
  }
  else if (b == stuff_last_bit)
  {
      stuff_counter++;
  }
  else
  {
    stuff_counter = 1;
  }

  stuff_last_bit = b;
  return ret;
}

function stuffing_check(b)
{
  var ret = -1;
  stuff_counter++;
  if (stuff_counter >= 5)
  {
    ret =  (!stuff_last_bit) & 0x1;
    stuffed_bit_counter++;
    stuff_counter = 0;
  }
  else
  {
  }
  if (b != stuff_last_bit)
  {
    stuff_counter = 0;
  }
  stuff_last_bit = b;
  return ret;
}

/**
Same as check_stuffing but for the CRC field of CAN FD frames
where different stuffing rules applies
*/
function stuffing_build_fd_crc(b)
{
  var ret = -1;
  stuff_crc_counter++;
  if ((stuff_crc_counter >= 4) || (stuff_first_crc_bit))
  {
    ret =  (!stuff_last_bit) & 0x1;
    stuff_crc_counter = 0;
    stuff_first_crc_bit = false;
  }

  stuff_last_bit = b;
  return ret;
}

function stuffing_check_fd_crc(b)
{
  var ret = -1;
  stuff_crc_counter++;
  if ((stuff_crc_counter >= 5) || (stuff_first_crc_bit))
  {
    ret =  (!stuff_last_bit) & 0x1;
    stuff_crc_counter = 0;
    stuff_first_crc_bit = false;
  }

  stuff_last_bit = b;
  return ret;
}

function stuffing_reset()
{
  stuff_crc_counter = 0;
  stuff_counter = 0;
  stuff_first_crc_bit = true;
  stuff_last_bit = -1; //improbable value, to ensure next bit resets the stuffing counter
  stuffed_bit_counter = 0; //Used by builder in case of ISO-CRC
}

// CRC function
var crc_bits_destuffed = [];
var crc_bits_all = [];
function crc_reset()
{
  crc_bits_destuffed = [];
  crc_bits_all = [];
}

function crc_acc(b,is_stuffed_bit)
{
  b = Number(b);
  if (is_stuffed_bit == false)
  {
      crc_bits_destuffed.push(b);
      crc_bits_all.push(b);
  }
  else
  {
    crc_bits_all.push(b);
  }
}

function crc_get_len(n_data_bytes)
{
  var len;
  if (n_data_bytes > 16)
  {
    len = 21;
  }
  else
  {
    len = 17;
  }
  return len;
}

function get_even_parity(n)
{
    var i = 0;
    var count = 0;

    for (i = 0; i < 4; i++)
    {
      if ((n >> i) & 0x1)
      {
        count++;
      }
    }

    if (count%2)
    {
      return 1;
    }
    else
    {
      return 0;
    }
}

function gray_code(n)
{
    /* Right Shift the number by 1
       taking xor with original number */
    return n ^ (n >> 1);
}

function inverse_gray_code(n)
{
    var inv = 0;
    // Taking xor until n becomes zero
    for (; n; n = n >> 1)
        inv ^= n;

    return inv;
}

function crc_calc(bits,crc_len)
{
  var crc_nxt;
  var crc = 0;
  var b = 0;
  var poly;
  switch (crc_len) {
    case 17:
      poly = 0x3685B;
      break;
    case 21:
      poly = 0x302899;
      break;
    default: //15  bits
      poly = 0xC599;
  }

  if (can_fd_iso)
  {
    crc = (1 << (crc_len -1)); //NOTE: For CAN FD ISO only!
  }

  for (b = 0; b < bits.length; b++)
  {
    crc_nxt = bits[b] ^ ((crc >> (crc_len-1)) & 0x1);
    crc = crc << 1;
    //crc &= 0xFFFFFFFE; //useless line (?)
    if (crc_nxt == 1)
    {
      crc = (crc ^ poly);
      //crc = (crc ^ (poly & ~(1 << (crc_len))))
      //TODO: can't we just write crc = (crc ^ poly) ?
    }
    crc &= ~(1 << (crc_len));
  }
  return crc;
}

//------------------------------------------------------------------------------------------------------------------------------------------//
//                                                  END CAN Usefull Functions                                                               //
//------------------------------------------------------------------------------------------------------------------------------------------//

//------------------------------------------------------------------------------------------------------------------------------------------//
//                                                  PGN Alert/Alert RSP/Alert Text                                                          //
//------------------------------------------------------------------------------------------------------------------------------------------//

function alert_byte (decoder_items)
{
    var str = "";
    switch (fast_packet_byte)
    {
        case 1 :
        {
            var alert_type = (hex_value>>4);
            var alert_category = hex_value&0xF;
            switch (alert_type)
            {
                case 1 :
                {
                    str = "Emergency Alarm";
                    break;
                }
                case 2 :
                {
                    str = "Alarm";
                    break;
                }
                case 5 :
                {
                    str = "Warning";
                    break;
                }
                case 8 :
                {
                    str = "Caution";
                    break;
                }
                case 14 :
                {
                    str = "Data out of range";
                    break;
                }
                case 15 :
                {
                    str = "Data not available";
                    break;
                }
                default :
                {
                    str = "Reserved";
                    break;
                }
            }
            end_alert_type = decoder_items.start_sample_index + 4*(decoder_items.end_sample_index - decoder_items.start_sample_index)/8;
            ScanaStudio.dec_item_new(decoder_items.channel_index,decoder_items.start_sample_index,end_alert_type);
            ScanaStudio.dec_item_add_content("Alert Type : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_add_content("0x" + pad(alert_type.toString(16),1));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                end_alert_type,
                "Alert Data",
                ("Alert Type : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            switch (alert_category)
            {
                case 0 :
                {
                    str = "Navigational";
                    break;
                }
                case 1 :
                {
                    str = "Technical";
                    break;
                }
                case 14 :
                {
                    str = "Data out of range";
                    break;
                }
                case 15 :
                {
                    str = "Data not available";
                    break;
                }
                default :
                {
                    str = "Reserved";
                    break;
                }
            }
            ScanaStudio.dec_item_new(decoder_items.channel_index,end_alert_type,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Alert Category : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_add_content("0x" + pad(alert_category.toString(16),1));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                end_alert_type,
                decoder_items.end_sample_index,
                "Alert Category",
                (str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 2 :
        {
            item_content = "Alert System : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 3 :
        {
            item_content = "Alert Sub-System : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 4 :
        case 5 :
        {
            item_content = "Alert ID : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 6 :
        case 7 :
        case 8 :
        case 9 :
        case 10 :
        case 11 :
        case 12 :
        case 13 :
        {
            item_content = "Source Network ID NAME : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 14 :
        {
            item_content = "Data Source Instance : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 15 :
        {
            item_content = "Data Source Index/Source : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 16 :
        {
            item_content = "Alert Occurrence Number : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 17 :
        {
            var bit_length = (decoder_items.end_sample_index - decoder_items.start_sample_index)/8;
            if (((hex_value>>7)&0x1) == 0)
            {
                str = "Not Temporary Silence";
            }
            else
            {
                str = "Temporary Silence";
            }
            ScanaStudio.dec_item_new(decoder_items.channel_index,decoder_items.start_sample_index,decoder_items.start_sample_index + bit_length);
            ScanaStudio.dec_item_add_content("Temporary Silence Status : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                decoder_items.start_sample_index + bit_length,
                "Temp Silence Stat",
                (str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            if (((hex_value>>6)&0x1) == 0)
            {
                str = "Not Acknowledged";
            }
            else
            {
                str = "Acknowledged";
            }
            ScanaStudio.dec_item_new(decoder_items.channel_index,decoder_items.start_sample_index + bit_length,decoder_items.start_sample_index + 2*bit_length);
            ScanaStudio.dec_item_add_content("Acknowledge Status : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index + bit_length,
                decoder_items.start_sample_index + 2*bit_length,
                "Alert Data",
                ("Ack Status : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            if (((hex_value>>5)&0x1) == 0)
            {
                str = "Not Escalated";
            }
            else
            {
                str = "Escalated";
            }
            ScanaStudio.dec_item_new(decoder_items.channel_index,decoder_items.start_sample_index + 2*bit_length,decoder_items.start_sample_index + 3*bit_length);
            ScanaStudio.dec_item_add_content("Escalation Status : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index + 2*bit_length,
                decoder_items.start_sample_index + 3*bit_length,
                "Alert Data",
                ("Escalation Stat : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            if (((hex_value>>4)&0x1) == 0)
            {
                str = "Not Supported";
            }
            else
            {
                str = "Supported";
            }
            ScanaStudio.dec_item_new(decoder_items.channel_index,decoder_items.start_sample_index + 3*bit_length,decoder_items.start_sample_index + 4*bit_length);
            ScanaStudio.dec_item_add_content("Temporary Silence Status : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index + 3*bit_length,
                decoder_items.start_sample_index + 4*bit_length,
                "Alert Data",
                ("Temp Silence : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            if (((hex_value>>3)&0x1) == 0)
            {
                str = "Not Supported";
            }
            else
            {
                str = "Supported";
            }
            ScanaStudio.dec_item_new(decoder_items.channel_index,decoder_items.start_sample_index + 4*bit_length,decoder_items.start_sample_index + 5*bit_length);
            ScanaStudio.dec_item_add_content("Acknowledge Status : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index + 4*bit_length,
                decoder_items.start_sample_index + 5*bit_length,
                "Alert Data",
                ("Ack Status : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            if (((hex_value>>2)&0x1) == 0)
            {
                str = "Not Supported";
            }
            else
            {
                str = "Supported";
            }
            ScanaStudio.dec_item_new(decoder_items.channel_index,decoder_items.start_sample_index + 5*bit_length,decoder_items.start_sample_index + 6*bit_length);
            ScanaStudio.dec_item_add_content("Escalation Status : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index + 5*bit_length,
                decoder_items.start_sample_index + 6*bit_length,
                "Alert Data",
                ("Escalation Stat : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            // NMEA Reserved
            ScanaStudio.dec_item_new(decoder_items.channel_index,decoder_items.start_sample_index + 6*bit_length,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("NMEA Reserved : 0x" + ((hex_value)&0x3));
            ScanaStudio.dec_item_add_content(((hex_value)&0x3));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index + 6*bit_length,
                decoder_items.end_sample_index,
                "Alert Data",
                ("NMEA Reserved : 0x" + ((hex_value)&0x3)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 18 :
        case 19 :
        case 20 :
        case 21 :
        case 22 :
        case 23 :
        case 24 :
        case 25 :
        {
            item_content = "Acknowledge ID NAME : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 26 :
        {
            var alert_trigger = (hex_value>>4);
            var alert_treshold = hex_value&0xF;
            switch (alert_type)
            {
                case 0 :
                {
                    str = "Manual";
                    break;
                }
                case 1 :
                {
                    str = "Auto";
                    break;
                }
                case 2 :
                {
                    str = "Test";
                    break;
                }
                case 3 :
                {
                    str = "Disabled";
                    break;
                }
                case 14 :
                {
                    str = "Data out of range";
                    break;
                }
                case 15 :
                {
                    str = "Data not available";
                    break;
                }
                default :
                {
                    str = "Reserved";
                    break;
                }
            }
            end_alert_trigger = decoder_items.start_sample_index + 4*(decoder_items.end_sample_index - decoder_items.start_sample_index)/8;
            ScanaStudio.dec_item_new(decoder_items.channel_index,decoder_items.start_sample_index,end_alert_trigger);
            ScanaStudio.dec_item_add_content("Alert Trigger Condition : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                end_alert_trigger,
                "Alert Data",
                "Alert Trig Cond : " + str,
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            switch (alert_treshold)
            {
                case 0 :
                {
                    str = "Normal";
                    break;
                }
                case 1 :
                {
                    str = "Threshold Exceeded";
                    break;
                }
                case 2 :
                {
                    str = "Extreme Threshold Exceeded";
                    break;
                }
                case 3 :
                {
                    str = "Low Threshold Exceeded";
                    break;
                }
                case 4 :
                {
                    str = "Acknowledged";
                    break;
                }
                case 5 :
                {
                    str = "Awaiting Acknowledge";
                    break;
                }
                case 14 :
                {
                    str = "Data out of range";
                    break;
                }
                case 15 :
                {
                    str = "Data not available";
                    break;
                }
                default :
                {
                    str = "Reserved";
                    break;
                }
            }
            ScanaStudio.dec_item_new(decoder_items.channel_index,end_alert_trigger,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Alert Threshold Status : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                end_alert_trigger,
                decoder_items.end_sample_index,
                "Threshold Status",
                str,
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 27 :
        {
            item_content = "Alert Priority : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 28 :
        {
            switch (hex_value)
            {
                case 0 :
                {
                    str = "Disabled";
                    break;
                }
                case 1 :
                {
                    str = "Normal";
                    break;
                }
                case 2 :
                {
                    str = "Active";
                    break;
                }
                case 3 :
                {
                    str = "Silenced";
                    break;
                }
                case 4 :
                {
                    str = "Acknowledged";
                    break;
                }
                case 5 :
                {
                    str = "Awaiting Acknowledge";
                    break;
                }
                case 14 :
                {
                    str = "Data out of range";
                    break;
                }
                case 15 :
                {
                    str = "Data not available";
                    break;
                }
                default :
                {
                    str = "Reserved";
                    break;
                }
            }
            item_content = "Alert State : " + str;
            break;
        }
        default :
        {
            packet_title = "Filled Data";
            if (hex_value == 255)
            {
                item_content = "Filled with 0xFF";
            }
            else
            {
                item_content = "0x" + pad(hex_value.toString(16),2) + ", should be 0xFF";
                types_title = ScanaStudio.PacketColors.Error.Title;
                types_content = ScanaStudio.PacketColors.Error.Content;
            }
        }
    }//end switch (byte)
}//end function alert_byte

function alert_response_byte (decoder_items)
{
    var str = "";
    switch (fast_packet_byte)
    {
        case 1 :
        {
            var alert_type = (hex_value>>4);
            var alert_category = hex_value&0xF;
            switch (alert_type)
            {
                case 1 :
                {
                    str = "Emergency Alarm";
                    break;
                }
                case 2 :
                {
                    str = "Alarm";
                    break;
                }
                case 5 :
                {
                    str = "Warning";
                    break;
                }
                case 8 :
                {
                    str = "Caution";
                    break;
                }
                case 14 :
                {
                    str = "Data out of range";
                    break;
                }
                case 15 :
                {
                    str = "Data not available";
                    break;
                }
                default :
                {
                    str = "Reserved";
                    break;
                }
            }
            end_alert_type = decoder_items.start_sample_index + 4*(decoder_items.end_sample_index - decoder_items.start_sample_index)/8;
            ScanaStudio.dec_item_new(decoder_items.channel_index,decoder_items.start_sample_index,end_alert_type);
            ScanaStudio.dec_item_add_content("Alert Type : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_add_content("0x" + pad(alert_type.toString(16),1));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                end_alert_type,
                "Alert RSP Data",
                ("Alert Type : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            switch (alert_category)
            {
                case 0 :
                {
                    str = "Navigational";
                    break;
                }
                case 1 :
                {
                    str = "Technical";
                    break;
                }
                case 14 :
                {
                    str = "Data out of range";
                    break;
                }
                case 15 :
                {
                    str = "Data not available";
                    break;
                }
                default :
                {
                    str = "Reserved";
                    break;
                }
            }
            ScanaStudio.dec_item_new(decoder_items.channel_index,end_alert_type,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Alert Category : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_add_content("0x" + pad(alert_category.toString(16),1));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                end_alert_type,
                decoder_items.end_sample_index,
                "Alert Category",
                (str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 2 :
        {
            item_content = "Alert System : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 3 :
        {
            item_content = "Alert Sub-System : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 4 :
        case 5 :
        {
            item_content = "Alert ID : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 6 :
        case 7 :
        case 8 :
        case 9 :
        case 10 :
        case 11 :
        case 12 :
        case 13 :
        {
            item_content = "Source Network ID NAME : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 14 :
        {
            item_content = "Data Source Instance : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 15 :
        {
            item_content = "Data Source Index/Source : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 16 :
        {
            item_content = "Alert Occurrence Number : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 17 :
        case 18 :
        case 19 :
        case 20 :
        case 21 :
        case 22 :
        case 23 :
        case 24 :
        {
            item_content = "Acknowledge ID NAME : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 25 :
        {
            var response_command = (hex_value>>6);
            var NMEA_reserved = hex_value&0x3F;
            switch (response_command)
            {
                case 0 :
                {
                    str = "Acknowledge";
                    break;
                }
                case 1 :
                {
                    str = "Temporary Silence";
                    break;
                }
                case 2 :
                {
                    str = "Test Command off";
                    break;
                }
                case 3 :
                {
                    str = "Test Command on";
                    break;
                }
                default :
                {
                    str = "Reserved";
                    break;
                }
            }
            end_response_command = decoder_items.start_sample_index + 4*(decoder_items.end_sample_index - decoder_items.start_sample_index)/8;
            ScanaStudio.dec_item_new(decoder_items.channel_index,decoder_items.start_sample_index,end_response_command);
            ScanaStudio.dec_item_add_content("Response Command : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                end_response_command,
                "Alert RSP Data",
                "RSP Command : " + str,
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            ScanaStudio.dec_item_new(decoder_items.channel_index,end_response_command,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("NMEA Reserved : 0x" + pad(NMEA_reserved.toString(16),1));
            ScanaStudio.dec_item_add_content(NMEA_reserved);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                end_response_command,
                decoder_items.end_sample_index,
                "Alert RSP Data",
                "NMEA Reserved : 0x" + pad(NMEA_reserved.toString(16),1),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        default :
        {
            packet_title = "Filled Data";
            if (hex_value == 255)
            {
                item_content = "Filled with 0xFF";
            }
            else
            {
                item_content = "0x" + pad(hex_value.toString(16),2) + ", should be 0xFF";
                types_title = ScanaStudio.PacketColors.Error.Title;
                types_content = ScanaStudio.PacketColors.Error.Content;
            }
        }
    }//end switch (byte)
}//end function alert_response_byte


function alert_text_byte (decoder_items)
{
    var str = "";
    switch (fast_packet_byte)
    {
        case 1 :
        {
            var alert_type = (hex_value>>4);
            var alert_category = hex_value&0xF;
            switch (alert_type)
            {
                case 1 :
                {
                    str = "Emergency Alarm";
                    break;
                }
                case 2 :
                {
                    str = "Alarm";
                    break;
                }
                case 5 :
                {
                    str = "Warning";
                    break;
                }
                case 8 :
                {
                    str = "Caution";
                    break;
                }
                case 14 :
                {
                    str = "Data out of range";
                    break;
                }
                case 15 :
                {
                    str = "Data not available";
                    break;
                }
                default :
                {
                    str = "Reserved";
                    break;
                }
            }
            end_alert_type = decoder_items.start_sample_index + 4*(decoder_items.end_sample_index - decoder_items.start_sample_index)/8;
            ScanaStudio.dec_item_new(decoder_items.channel_index,decoder_items.start_sample_index,end_alert_type);
            ScanaStudio.dec_item_add_content("Alert Type : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_add_content("0x" + pad(alert_type.toString(16),1));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                end_alert_type,
                "Alert Text Data",
                ("Alert Type : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            switch (alert_category)
            {
                case 0 :
                {
                    str = "Navigational";
                    break;
                }
                case 1 :
                {
                    str = "Technical";
                    break;
                }
                case 14 :
                {
                    str = "Data out of range";
                    break;
                }
                case 15 :
                {
                    str = "Data not available";
                    break;
                }
                default :
                {
                    str = "Reserved";
                    break;
                }
            }
            ScanaStudio.dec_item_new(decoder_items.channel_index,end_alert_type,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Alert Category : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_add_content("0x" + pad(alert_category.toString(16),1));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                end_alert_type,
                decoder_items.end_sample_index,
                "Alert Category",
                (str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 2 :
        {
            item_content = "Alert System : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 3 :
        {
            item_content = "Alert Sub-System : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 4 :
        case 5 :
        {
            item_content = "Alert ID : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 6 :
        case 7 :
        case 8 :
        case 9 :
        case 10 :
        case 11 :
        case 12 :
        case 13 :
        {
            item_content = "Source Network ID NAME : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 14 :
        {
            item_content = "Data Source Instance : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 15 :
        {
            item_content = "Data Source Index/Source : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 16 :
        {
            item_content = "Alert Occurrence Number : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 17 :
        {
            item_content = "Language ID : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 18 :
        case 19 :
        case 20 :
        case 21 :
        case 22 :
        case 23 :
        case 24 :
        case 25 :
        case 26 :
        case 27 :
        case 28 :
        case 29 :
        case 30 :
        case 31 :
        case 32 :
        case 33 :
        {
            item_content = "Alert Text Description: 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 34 :
        case 35 :
        case 36 :
        case 37 :
        case 38 :
        case 39 :
        case 40 :
        case 41 :
        case 42 :
        case 43 :
        case 44 :
        case 45 :
        case 46 :
        case 47 :
        case 48 :
        case 49 :
        {
            item_content = "Location Text Description : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        default :
        {
            packet_title = "Filled Data";
            if (hex_value == 255)
            {
                item_content = "Filled with 0xFF";
            }
            else
            {
                item_content = "0x" + pad(hex_value.toString(16),2) + ", should be 0xFF";
                types_title = ScanaStudio.PacketColors.Error.Title;
                types_content = ScanaStudio.PacketColors.Error.Content;
            }
        }
    }//end switch (byte)
}//end function alert_text_byte

//------------------------------------------------------------------------------------------------------------------------------------------//
//                                                  PGN Alert/Alert RSP/Alert Text                                                          //
//------------------------------------------------------------------------------------------------------------------------------------------//


//------------------------------------------------------------------------------------------------------------------------------------------//
//                                                         FAST-PACKET PGN                                                                  //
//------------------------------------------------------------------------------------------------------------------------------------------//

function Product_Information (decoder_items) //126996
{
    var str = "";
    if (fast_packet_byte == 1)
    {
        start_item = decoder_items.start_sample_index;
        multi_byte_value = hex_value;
        skip_item = true;
    }
    else if (fast_packet_byte == 2)
    {
        multi_byte_value += (hex_value<<8);
        ScanaStudio.dec_item_new(decoder_items.channel_index, start_item, decoder_items.end_sample_index);
        ScanaStudio.dec_item_add_content("NMEA 2000 Version : 0x" + pad(multi_byte_value.toString(16),4));
        ScanaStudio.dec_item_add_content("0x" + pad(multi_byte_value.toString(16),4));
        ScanaStudio.dec_item_end();
        // Packet View
        ScanaStudio.packet_view_add_packet(false,
            decoder_items.channel_index,
            start_item,
            decoder_items.end_sample_index,
            "Fast Packet Data",
            ("NMEA 2000 Version : 0x" + pad(multi_byte_value.toString(16),4)),
            ScanaStudio.PacketColors.Data.Title,
            ScanaStudio.PacketColors.Data.Content);
        skip_item = true;
    }
    else if (fast_packet_byte == 3)
    {
        start_item = decoder_items.start_sample_index;
        multi_byte_value = hex_value;
        skip_item = true;
    }
    else if (fast_packet_byte == 4)
    {
        multi_byte_value += (hex_value<<8);
        ScanaStudio.dec_item_new(decoder_items.channel_index, start_item, decoder_items.end_sample_index);
        ScanaStudio.dec_item_add_content("Product Code : 0x" + pad(multi_byte_value.toString(16),4));
        ScanaStudio.dec_item_add_content("0x" + pad(multi_byte_value.toString(16),4));
        ScanaStudio.dec_item_end();
        // Packet View
        ScanaStudio.packet_view_add_packet(false,
            decoder_items.channel_index,
            start_item,
            decoder_items.end_sample_index,
            "Fast Packet Data",
            ("Product Code : 0x" + pad(multi_byte_value.toString(16),4)),
            ScanaStudio.PacketColors.Data.Title,
            ScanaStudio.PacketColors.Data.Content);
        skip_item = true;
    }
    else if ((fast_packet_byte > 4) && (fast_packet_byte < 37))
    {
        item_content = "Model ID : " + "'" + String.fromCharCode(hex_value) + "'";
    }
    else if ((fast_packet_byte > 36) && (fast_packet_byte < 69))
    {
        item_content = "Software Version Code : " + "'" + String.fromCharCode(hex_value) + "'";
    }
    else if ((fast_packet_byte > 68) && (fast_packet_byte < 101))
    {
        item_content = "Model Version : " + "'" + String.fromCharCode(hex_value) + "'";
    }
    else if ((fast_packet_byte > 100) && (fast_packet_byte < 133))
    {
        item_content = "Model Serial Code : " + "'" + String.fromCharCode(hex_value) + "'";
    }
    else if (fast_packet_byte == 133)
    {
        item_content = "Certification Level : 0x" + pad(hex_value.toString(16),2);
    }
    else if (fast_packet_byte == 134)
    {
        item_content = "Load Equivalency : 0x" + pad(hex_value.toString(16),2);
    }
    else
    {
        packet_title = "Filled Data";
        if (hex_value == 255)
        {
            item_content = "Filled with 0xFF";
        }
        else
        {
            item_content = "0x" + pad(hex_value.toString(16),2) + ", should be 0xFF";
            types_title = ScanaStudio.PacketColors.Error.Title;
            types_content = ScanaStudio.PacketColors.Error.Content;
        }
    }
}//end function Product_Information

function Configuration_Information (decoder_items) //126998
{
    var str = "";
    switch (fast_packet_byte)
    {
        case 1 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 2 :
        {
            multi_byte_value += (hex_value<<8);
            ScanaStudio.dec_item_new(decoder_items.channel_index, start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Installation Description #1 : 0x" + pad(multi_byte_value.toString(16),4));
            ScanaStudio.dec_item_add_content("0x" + pad(multi_byte_value.toString(16),4));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Installation",
                ("Description #1 : 0x" + pad(multi_byte_value.toString(16),4)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 3 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 4 :
        {
            multi_byte_value += (hex_value<<8);
            ScanaStudio.dec_item_new(decoder_items.channel_index, start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Installation Description #3 : 0x" + pad(multi_byte_value.toString(16),4));
            ScanaStudio.dec_item_add_content("0x" + pad(multi_byte_value.toString(16),4));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Installation",
                ("Description #3 : 0x" + pad(multi_byte_value.toString(16),4)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 5 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 6 :
        {
            multi_byte_value += (hex_value<<8);
            ScanaStudio.dec_item_new(decoder_items.channel_index, start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Installation Description #3 : 0x" + pad(multi_byte_value.toString(16),4));
            ScanaStudio.dec_item_add_content("0x" + pad(multi_byte_value.toString(16),4));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Installation",
                ("Description #3 : 0x" + pad(multi_byte_value.toString(16),4)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 7 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 8 :
        {
            multi_byte_value += (hex_value<<8);
            ScanaStudio.dec_item_new(decoder_items.channel_index, start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Manufacturer Information : 0x" + pad(multi_byte_value.toString(16),4));
            ScanaStudio.dec_item_add_content("0x" + pad(multi_byte_value.toString(16),4));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("Manufacturer Information : 0x" + pad(multi_byte_value.toString(16),4)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        default :
        {
            packet_title = "Filled Data";
            if (hex_value == 255)
            {
                item_content = "Filled with 0xFF";
            }
            else
            {
                item_content = "0x" + pad(hex_value.toString(16),2) + ", should be 0xFF";
                types_title = ScanaStudio.PacketColors.Error.Title;
                types_content = ScanaStudio.PacketColors.Error.Content;
            }
        }
    }//end switch (byte)
}//end function Configuration_Information

function Man_Overboard_Notification (decoder_items) //127233
{
    var str = "";
    switch (fast_packet_byte)
    {
        case 1 :
        {
            item_content = "SID : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 2 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 3 :
        {
            multi_byte_value += (hex_value<<8);
            skip_item = true;
            break;
        }
        case 4 :
        {
            multi_byte_value += (hex_value<<16);
            skip_item = true;
            break;
        }
        case 5 :
        {
            multi_byte_value += hex_value*Math.pow(2,24);
            ScanaStudio.dec_item_new(decoder_items.channel_index, start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("MOB Emitter ID : 0x" + pad(multi_byte_value.toString(16),8));
            ScanaStudio.dec_item_add_content("0x" + pad(multi_byte_value.toString(16),8));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("MOB Emitter ID : 0x" + pad(multi_byte_value.toString(16),8)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 6 :
        {
            var man_overboard_status = (hex_value>>5);
            var reserved = hex_value&0x1F;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)*3/8;
            switch (man_overboard_status)
            {
                case 0 :
                {
                    str = "MOB Emitter Activated";
                    break;
                }
                case 1 :
                {
                    str = "Manual on-board MOB Button Activation";
                    break;
                }
                case 2 :
                {
                    str = "Test Mode";
                    break;
                }
                case 3 :
                {
                    str = "MOB Not Active";
                    break;
                }
                default :
                {
                    str = "Reserved";
                    break;
                }
            }
            ScanaStudio.dec_item_new(decoder_items.channel_index, decoder_items.start_sample_index, end_item);
            ScanaStudio.dec_item_add_content("Man Overboard Status : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                end_item,
                "Man Overboard ",
                ("Status : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            ScanaStudio.dec_item_new(decoder_items.channel_index, end_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Reserved : 0x" + pad(reserved.toString(16),2));
            ScanaStudio.dec_item_add_content("Reserved");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                end_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("Reserved : 0x" + pad(reserved.toString(16),2)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 7 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 8 :
        {
            multi_byte_value += (hex_value<<8);
            skip_item = true;
            break;
        }
        case 9 :
        {
            multi_byte_value += (hex_value<<16);
            skip_item = true;
            break;
        }
        case 10 :
        {
            multi_byte_value += hex_value*Math.pow(2,24);
            system_time.setTime((multi_byte_value/10)-(3600*1000)); // the Date object is initialize the 1 january, 1970 at 1am
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Activation Time : " + system_time.getHours() + "h" + system_time.getMinutes() + "min" + system_time.getSeconds() + "sec");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("Activation Time : " + system_time.getHours() + "h" + system_time.getMinutes() + "min" + system_time.getSeconds() + "sec"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 11 :
        {
            var position_source = (hex_value>>5);
            var reserved = hex_value&0x1F;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)*3/8;
            switch (position_source)
            {
                case 0 :
                {
                    str = "Position estimated by the Vessel";
                    break;
                }
                case 1 :
                {
                    str = "Position reported by MOB emitter";
                    break;
                }
                default :
                {
                    str = "Reserved";
                    break;
                }
            }
            ScanaStudio.dec_item_new(decoder_items.channel_index, decoder_items.start_sample_index, end_item);
            ScanaStudio.dec_item_add_content("Position Source : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                end_item,
                "Position Source ",
                (str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            ScanaStudio.dec_item_new(decoder_items.channel_index, end_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Reserved : 0x" + pad(reserved.toString(16),2));
            ScanaStudio.dec_item_add_content("Reserved");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                end_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("Reserved : 0x" + pad(reserved.toString(16),2)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 12 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 13 :
        {
            multi_byte_value += (hex_value<<8);
            system_time.setTime((multi_byte_value)*1000*24*3600);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Position Date : " + system_time.getMonth() + "/" + system_time.getDate() + "/" + system_time.getFullYear() + " (month/day/year)");
            ScanaStudio.dec_item_add_content("Position Date : " + system_time.getMonth() + "/" + system_time.getDate() + "/" + system_time.getFullYear());
            ScanaStudio.dec_item_add_content(system_time.getMonth() + "/" + system_time.getDate() + "/" + system_time.getFullYear());
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Position Date",
                (system_time.getMonth() + "/" + system_time.getDate() + "/" + system_time.getFullYear() + " (month/day/year)"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 14 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 15 :
        {
            multi_byte_value += (hex_value<<8);
            skip_item = true;
            break;
        }
        case 16 :
        {
            multi_byte_value += (hex_value<<16);
            skip_item = true;
            break;
        }
        case 17 :
        {
            multi_byte_value += hex_value*Math.pow(2,24);
            system_time.setTime((multi_byte_value/10)-(3600*1000)); // the Date object is initialize the 1 january, 1970 at 1am
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Position Time : " + system_time.getHours() + "h" + system_time.getMinutes() + "min" + system_time.getSeconds() + "sec");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("Position Time : " + system_time.getHours() + "h" + system_time.getMinutes() + "min" + system_time.getSeconds() + "sec"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 18 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 19 :
        {
            multi_byte_value += (hex_value<<8);
            skip_item = true;
            break;
        }
        case 20 :
        {
            multi_byte_value += (hex_value<<16);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Latitude : 0x" + pad(multi_byte_value.toString(16),6));
            ScanaStudio.dec_item_add_content("0x" + pad(multi_byte_value.toString(16),6));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("Latitude : 0x" + pad(multi_byte_value.toString(16),6)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 21 :
        {
            item_content = "Latitude : 0x" + pad(multi_byte_value.toString(16),2);
            break;
        }
        case 22 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 23 :
        {
            multi_byte_value += (hex_value<<8);
            skip_item = true;
            break;
        }
        case 24 :
        {
            multi_byte_value += (hex_value<<16);
            skip_item = true;
            break;
        }
        case 25 :
        {
            multi_byte_value += hex_value*Math.pow(2,24);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Longitude : 0x" + pad(multi_byte_value.toString(16),8));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("Longitude : 0x" + pad(multi_byte_value.toString(16),8)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 26 :
        {
            var cog_reference = (hex_value>>6);
            var reserved = hex_value&0x3;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)*3/8;
            str = LOOKUP_DIRECTION_REFERENCE(cog_reference);
            ScanaStudio.dec_item_new(decoder_items.channel_index, decoder_items.start_sample_index, end_item);
            ScanaStudio.dec_item_add_content("COG Reference : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                end_item,
                "Fast Packet Data",
                ("COG Reference : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            ScanaStudio.dec_item_new(decoder_items.channel_index, end_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Reserved : 0x" + pad(reserved.toString(16),2));
            ScanaStudio.dec_item_add_content("Reserved");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                end_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("Reserved : 0x" + pad(reserved.toString(16),2)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 27 :
        {
            item_content = "COG (LSByte) : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 28 :
        {
            item_content = "COG (MSByte) : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 29 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 30 :
        {
            multi_byte_value += (hex_value<<8);
            multi_byte_value = multi_byte_value*0.01;
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("SOG : " + multi_byte_value.toFixed(2) + " m/s");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(2) + " m/s");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("COG : " + multi_byte_value.toFixed(2) + " m/s"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 31 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 32 :
        {
            multi_byte_value += (hex_value<<8);
            skip_item = true;
            break;
        }
        case 33 :
        {
            multi_byte_value += (hex_value<<16);
            skip_item = true;
            break;
        }
        case 34 :
        {
            multi_byte_value += hex_value*Math.pow(2,24);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("MMSI of vessel of origin : 0x" + pad(multi_byte_value.toString(16),8));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "MMSI of vessel",
                ("of origin : 0x" + pad(multi_byte_value.toString(16),8)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 35 :
        {
            var mob_emitter = (hex_value>>5);
            var reserved = hex_value&0x3;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)*3/8;
            switch (cog_reference)
            {
                case 0 :
                {
                    str = "Good";
                    break;
                }
                case 1 :
                {
                    str = "Low";
                    break;
                }
                default :
                {
                    str = "Reserved";
                }
            }
            ScanaStudio.dec_item_new(decoder_items.channel_index, decoder_items.start_sample_index, end_item);
            ScanaStudio.dec_item_add_content("MOB Emitter Battery Status : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                end_item,
                "MOB Emitter",
                ("Battery Status : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            ScanaStudio.dec_item_new(decoder_items.channel_index, end_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Reserved : 0x" + pad(reserved.toString(16),2));
            ScanaStudio.dec_item_add_content("Reserved");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                end_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("Reserved : 0x" + pad(reserved.toString(16),2)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        default :
        {
            packet_title = "Filled Data";
            if (hex_value == 255)
            {
                item_content = "Filled with 0xFF";
            }
            else
            {
                item_content = "0x" + pad(hex_value.toString(16),2) + ", should be 0xFF";
                types_title = ScanaStudio.PacketColors.Error.Title;
                types_content = ScanaStudio.PacketColors.Error.Content;
            }
        }
    }//end switch (byte)
}//end function Man_Overboard_Notification

function Heading_Track_control (decoder_items) //127237
{
    var str = "";
    switch (fast_packet_byte)
    {
        case 1 :
        {
            var rudder_limit = (hex_value>>6);
            var off_heading = (hex_value>>4)&0x3;
            var off_track = (hex_value>>2)&0x3;
            var override = hex_value&0x3;
            var quarter_length = (decoder_items.end_sample_index - decoder_items.start_sample_index)/4;
            str = LOOKUP_YES_NO(rudder_limit);
            ScanaStudio.dec_item_new(decoder_items.channel_index,decoder_items.start_sample_index ,decoder_items.start_sample_index + quarter_length);
            ScanaStudio.dec_item_add_content("Rudder Limit Exceeded : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                decoder_items.start_sample_index + quarter_length,
                "Rudder",
                ("Limit Exceeded : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            str = LOOKUP_YES_NO(off_heading);
            ScanaStudio.dec_item_new(decoder_items.channel_index,decoder_items.start_sample_index + quarter_length,decoder_items.start_sample_index + quarter_length*2);
            ScanaStudio.dec_item_add_content("Off-Heading Limit Exceeded : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index + quarter_length,
                decoder_items.start_sample_index + quarter_length*2,
                "Off-Heading ",
                ("Limit Exceeded : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            str = LOOKUP_YES_NO(off_track);
            ScanaStudio.dec_item_new(decoder_items.channel_index,decoder_items.start_sample_index + quarter_length*2,decoder_items.start_sample_index + quarter_length*3);
            ScanaStudio.dec_item_add_content("Off-Track Limit Exceeded : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index + quarter_length*2,
                decoder_items.start_sample_index + quarter_length*3,
                "Off-Track",
                ("Limit Exceeded : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            str = LOOKUP_YES_NO(override);
            ScanaStudio.dec_item_new(decoder_items.channel_index,decoder_items.start_sample_index + quarter_length*3,decoder_items.start_sample_index + quarter_length*4);
            ScanaStudio.dec_item_add_content("Override : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index + quarter_length*3,
                decoder_items.start_sample_index + quarter_length*4,
                "Fast Packet Data",
                ("Override : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 2 :
        {
            var steering_mode = (hex_value>>5);
            var turn_mode = (hex_value>>2)&0x7;
            var heading_reference = hex_value&0x3;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/8*3;
            switch (steering_mode)
            {
                case 0 :
                {
                    str = "Main Steering";
                    break;
                }
                case 1 :
                {
                    str = "Non-Follow-up Device";
                    break;
                }
                case 2 :
                {
                    str = "Follow-up Device";
                    break;
                }
                case 3 :
                {
                    str = "Heading Control Standalone";
                    break;
                }
                case 4 :
                {
                    str = "Heading Control";
                    break;
                }
                case 5 :
                {
                    str = "Track Control";
                    break;
                }
                default :
                {
                    str = "Reserved";
                    break;
                }
            }
            ScanaStudio.dec_item_new(decoder_items.channel_index,decoder_items.start_sample_index , end_item);
            ScanaStudio.dec_item_add_content("Steering Mode : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                end_item,
                "Steering Mode",
                ("" + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            switch (turn_mode)
            {
                case 0 :
                {
                    str = "Rudder Limit controlled";
                    break;
                }
                case 1 :
                {
                    str = "turn rate controlled";
                    break;
                }
                case 2 :
                {
                    str = "radius controlled";
                    break;
                }
                default :
                {
                    str = "Reserved";
                    break;
                }
            }
            start_item = end_item;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)*5/8;
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,end_item);
            ScanaStudio.dec_item_add_content("Turn Mode : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                end_item,
                "Turn Mode",
                (str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            str = LOOKUP_DIRECTION_REFERENCE(heading_reference);
            ScanaStudio.dec_item_new(decoder_items.channel_index,end_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Heading Reference : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                end_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("Heading Reference : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 3 :
        {
            var reserved = (hex_value>>3);
            var commanded_rudder_direction = hex_value&0x7;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/8*5;
            ScanaStudio.dec_item_new(decoder_items.channel_index,decoder_items.start_sample_index , end_item);
            ScanaStudio.dec_item_add_content("Reserved : 0x" + pad(reserved.toString(16),2));
            ScanaStudio.dec_item_add_content("Reserved");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                end_item,
                "Fast Packet Data",
                ("Reserved : 0x" + pad(reserved.toString(16),2)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            switch (commanded_rudder_direction)
            {
                case 0 :
                {
                    str = "No Order";
                    break;
                }
                case 1 :
                {
                    str = "Move to starboard";
                    break;
                }
                case 2 :
                {
                    str = "Move to port";
                    break;
                }
                default :
                {
                    str = "Reserved";
                    break;
                }
            }
            ScanaStudio.dec_item_new(decoder_items.channel_index, end_item , decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Commanded Rudder Direction : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                end_item,
                decoder_items.end_sample_index,
                "Commanded Rudder",
                ("Direction : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 4 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 5 :
        {
            multi_byte_value += (hex_value<<8);
            multi_byte_value = multi_byte_value/10000;
            ScanaStudio.dec_item_new(decoder_items.channel_index, start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Commanded Rudder Angle : " + multi_byte_value.toFixed(4) + " rad");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(4) + " rad");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Commanded Rudder ",
                ("Angle : " + multi_byte_value.toFixed(4) + " rad"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 6 :
        {
            ScanaStudio.dec_item_new(decoder_items.channel_index, decoder_items.start_sample_index, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Heading to Steer (LSBytes) : 0x" + pad(hex_value.toString(16),2));
            ScanaStudio.dec_item_add_content("0x" + pad(hex_value.toString(16),2));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                decoder_items.end_sample_index,
                "Heading to Steer ",
                ("(LSBytes) : 0x" + pad(hex_value.toString(16),2)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 7 :
        {
            ScanaStudio.dec_item_new(decoder_items.channel_index, decoder_items.start_sample_index, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Heading to Steer (MSBytes) : 0x" + pad(hex_value.toString(16),2));
            ScanaStudio.dec_item_add_content("0x" + pad(hex_value.toString(16),2));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                decoder_items.end_sample_index,
                "Heading to Steer ",
                ("(MSBytes) : 0x" + pad(hex_value.toString(16),2)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 8 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 9 :
        {
            multi_byte_value += (hex_value<<8);
            multi_byte_value = multi_byte_value/10000;
            ScanaStudio.dec_item_new(decoder_items.channel_index, start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Track : " + multi_byte_value.toFixed(4) + " rad");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(4) + " rad");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("Track : " + multi_byte_value.toFixed(4) + " rad"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 10 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 11 :
        {
            multi_byte_value += (hex_value<<8);
            multi_byte_value = multi_byte_value/10000;
            ScanaStudio.dec_item_new(decoder_items.channel_index, start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Rudder Limit : " + multi_byte_value.toFixed(4) + " rad");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(4) + " rad");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("Rudder Limit : " + multi_byte_value.toFixed(4) + " rad"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 12 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 13 :
        {
            multi_byte_value += (hex_value<<8);
            multi_byte_value = multi_byte_value/10000;
            ScanaStudio.dec_item_new(decoder_items.channel_index, start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Off-Heading Limit : " + multi_byte_value.toFixed(4) + " rad");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(4) + " rad");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("Off-Heading Limit : " + multi_byte_value.toFixed(4) + " rad"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 14 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 15 :
        {
            multi_byte_value += (hex_value<<8);
            multi_byte_value = multi_byte_value/10000;
            ScanaStudio.dec_item_new(decoder_items.channel_index, start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Radius of Turn Order : " + multi_byte_value.toFixed(4) + " rad");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(4) + " rad");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Turn Order",
                ("Radius : " + multi_byte_value.toFixed(4) + " rad"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 16 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 17 :
        {
            multi_byte_value += (hex_value<<8);
            multi_byte_value = multi_byte_value/(1000*32);
            ScanaStudio.dec_item_new(decoder_items.channel_index, start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Rate of Turn Order : " + multi_byte_value.toFixed(5) + " rad/s");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(5) + " rad/s");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Turn Order",
                ("Rate : " + multi_byte_value.toFixed(5) + " rad/s"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 18 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 19 :
        {
            multi_byte_value += (hex_value<<8);
            ScanaStudio.dec_item_new(decoder_items.channel_index, start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Off-Track Limit : " + multi_byte_value + " m");
            ScanaStudio.dec_item_add_content(multi_byte_value + " m");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("Off-Track Limit : " + multi_byte_value + " m"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 20 :
        {
            ScanaStudio.dec_item_new(decoder_items.channel_index, decoder_items.start_sample_index, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Vessel Heading (LSByte) : 0x" + pad(hex_value.toString(16),2));
            ScanaStudio.dec_item_add_content("0x" + pad(hex_value.toString(16),2));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                decoder_items.end_sample_index,
                "Vessel Heading",
                ("(LSByte) : 0x" + pad(hex_value.toString(16),2)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 21 :
        {
            ScanaStudio.dec_item_new(decoder_items.channel_index, decoder_items.start_sample_index, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Vessel Heading (MSByte) : 0x" + pad(hex_value.toString(16),2));
            ScanaStudio.dec_item_add_content("0x" + pad(hex_value.toString(16),2));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                decoder_items.end_sample_index,
                "Vessel Heading",
                ("(MSByte) : 0x" + pad(hex_value.toString(16),2)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        default :
        {
            packet_title = "Filled Data";
            if (hex_value == 255)
            {
                item_content = "Filled with 0xFF";
            }
            else
            {
                item_content = "0x" + pad(hex_value.toString(16),2) + ", should be 0xFF";
                types_title = ScanaStudio.PacketColors.Error.Title;
                types_content = ScanaStudio.PacketColors.Error.Content;
            }
        }
    }//end switch (byte)
}//end function Heading_Track_control

function Engine_parameter_Dynamic (decoder_items) //127489
{
    var str = "";
    switch (fast_packet_byte)
    {
        case 1 :
        {
            str = LOOKUP_ENGINE_INSTANCE(hex_value);
            item_content = "Instance : 0x" + pad (hex_value.toString(16),2);
            break;
        }
        case 2 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 3 :
        {
            multi_byte_value += (hex_value<<8);
            ScanaStudio.dec_item_new(decoder_items.channel_index, start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Oil pressure : " + multi_byte_value + "hPa");
            ScanaStudio.dec_item_add_content(multi_byte_value + "hPa");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("Oil pressure : " + multi_byte_value + "hPa"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 4 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 5 :
        {
            multi_byte_value += (hex_value<<8);
            multi_byte_value = multi_byte_value*0.01;
            ScanaStudio.dec_item_new(decoder_items.channel_index, start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Oil temperature : " + multi_byte_value.toFixed(2) + " K");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(2) + " K");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("Oil temperature : " + multi_byte_value.toFixed(2) + " K"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 6 :
        {
            item_content = "Temperature (LSBytes) : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 7 :
        {
            item_content = "Temperature (MSBytes) : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 8 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 9 :
        {
            multi_byte_value += (hex_value<<8);
            multi_byte_value = multi_byte_value*0.01;
            ScanaStudio.dec_item_new(decoder_items.channel_index, start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Alternator Potential : " + multi_byte_value.toFixed(2) + " V");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(2) + " V");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Alternator ",
                ("Potential : " + multi_byte_value.toFixed(2) + " V"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 10 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 11 :
        {
            multi_byte_value += (hex_value<<8);
            multi_byte_value = multi_byte_value*0.1;
            ScanaStudio.dec_item_new(decoder_items.channel_index, start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Fuel Rate : " + multi_byte_value.toFixed(1) + " L/h");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(1) + " L/h");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Fuel ",
                ("Rate : " + multi_byte_value.toFixed(1) + " L/h"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 12 :
        {
            ScanaStudio.dec_item_new(decoder_items.channel_index, decoder_items.start_sample_index, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Total Engine hours (LSByte) : 0x" + pad(hex_value.toString(16),2));
            ScanaStudio.dec_item_add_content("0x" + pad(hex_value.toString(16),2));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                decoder_items.end_sample_index,
                "Total Engine hours",
                (" (LSByte) : 0x" + pad(hex_value.toString(16),2)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 13 :
        {
            ScanaStudio.dec_item_new(decoder_items.channel_index, decoder_items.start_sample_index, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Total Engine hours (2nd Byte) : 0x" + pad(hex_value.toString(16),2));
            ScanaStudio.dec_item_add_content("0x" + pad(hex_value.toString(16),2));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                decoder_items.end_sample_index,
                "Total Engine hours",
                (" (2nd Byte) : 0x" + pad(hex_value.toString(16),2)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 14 :
        {
            ScanaStudio.dec_item_new(decoder_items.channel_index, decoder_items.start_sample_index, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Total Engine hours (3rd Byte) : 0x" + pad(hex_value.toString(16),2));
            ScanaStudio.dec_item_add_content("0x" + pad(hex_value.toString(16),2));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                decoder_items.end_sample_index,
                "Total Engine hours",
                (" (3rd Byte) : 0x" + pad(hex_value.toString(16),2)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 15 :
        {
            ScanaStudio.dec_item_new(decoder_items.channel_index, decoder_items.start_sample_index, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Total Engine hours (MSByte) : 0x" + pad(hex_value.toString(16),2));
            ScanaStudio.dec_item_add_content("0x" + pad(hex_value.toString(16),2));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                decoder_items.end_sample_index,
                "Total Engine hours",
                (" (MSByte) : 0x" + pad(hex_value.toString(16),2)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 16 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 17 :
        {
            multi_byte_value += (hex_value<<8);
            ScanaStudio.dec_item_new(decoder_items.channel_index, start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Coolant Pressure : " + multi_byte_value + " hPa");
            ScanaStudio.dec_item_add_content(multi_byte_value + " hPa");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Coolant ",
                ("Pressure : " + multi_byte_value + " hPa"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 18 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 19 :
        {
            multi_byte_value += (hex_value<<8);
            ScanaStudio.dec_item_new(decoder_items.channel_index, start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Fuel Pressure : " + multi_byte_value + " kPa");
            ScanaStudio.dec_item_add_content(multi_byte_value + " kPa");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Fuel ",
                ("Pressure : " + multi_byte_value + " kPa"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 20 :
        {
            item_content = "Reserved : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 21 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 22 :
        {
            multi_byte_value += (hex_value<<8);
            str = LOOKUP_ENGINE_STATUS_1(multi_byte_value);
            ScanaStudio.dec_item_new(decoder_items.channel_index, start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Discrete Status 1 : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("Discrete Status 1 : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 23 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 24 :
        {
            multi_byte_value += (hex_value<<8);
            str = LOOKUP_ENGINE_STATUS_2(multi_byte_value);
            ScanaStudio.dec_item_new(decoder_items.channel_index, start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Discrete Status  : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("Discrete Status 2 : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 25 :
        {
            item_content = "Percent Engine Load : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 26 :
        {
            item_content = "Percent Engine Torque : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        default :
        {
            packet_title = "Filled Data";
            if (hex_value == 255)
            {
                item_content = "Filled with 0xFF";
            }
            else
            {
                item_content = "0x" + pad(hex_value.toString(16),2) + ", should be 0xFF";
                types_title = ScanaStudio.PacketColors.Error.Title;
                types_content = ScanaStudio.PacketColors.Error.Content;
            }
        }
    }//end switch (byte)
}//end function Engine_parameter_Dynamic

function Trip_parameters_Vessel (decoder_items) //127496
{
    var str = "";
    switch (fast_packet_byte)
    {
        case 1 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 2 :
        {
            multi_byte_value += (hex_value<<8);
            skip_item = true;
            break;
        }
        case 3 :
        {
            multi_byte_value += (hex_value<<16);
            skip_item = true;
            break;
        }
        case 4 :
        {
            multi_byte_value += hex_value*Math.pow(2,24);
            multi_byte_value = multi_byte_value*0.001;
            ScanaStudio.dec_item_new(decoder_items.channel_index, start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Time to Empty : " + multi_byte_value.toFixed(3).toString().replace(/(\d)(?=(\d{3})+\b)/g,'$1 ') + " s");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(3).toString().replace(/(\d)(?=(\d{3})+\b)/g,'$1 ') + " s");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("Time to Empty : " + multi_byte_value.toFixed(3).toString().replace(/(\d)(?=(\d{3})+\b)/g,'$1 ') + " s"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 5 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 6 :
        {
            multi_byte_value += (hex_value<<8);
            ScanaStudio.dec_item_new(decoder_items.channel_index, start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Distance to Empty (LSBytes) : 0x" + pad(multi_byte_value.toString(16),4));
            ScanaStudio.dec_item_add_content("0x" + pad(multi_byte_value.toString(16),4));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Distance to Empty",
                ("(LSBytes) : 0x" + pad(multi_byte_value.toString(16),4)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 7 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 8 :
        {
            multi_byte_value += (hex_value<<8);
            ScanaStudio.dec_item_new(decoder_items.channel_index, start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Distance to Empty (MSBytes) : 0x" + pad(multi_byte_value.toString(16),4));
            ScanaStudio.dec_item_add_content(multi_byte_value );
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Distance to Empty",
                ("(MSBytes) : 0x" + pad(multi_byte_value.toString(16),4)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 9 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 10 :
        {
            multi_byte_value += (hex_value<<8);
            ScanaStudio.dec_item_new(decoder_items.channel_index, start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Estimated Fuel Remaining : " + multi_byte_value + " L");
            ScanaStudio.dec_item_add_content(multi_byte_value + " L");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Estimated Fuel",
                ("Remaining : " + multi_byte_value + " L"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 11 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 12 :
        {
            multi_byte_value += (hex_value<<8);
            skip_item = true;
            break;
        }
        case 13 :
        {
            multi_byte_value += (hex_value<<16);
            ScanaStudio.dec_item_new(decoder_items.channel_index, start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Trip Run Time (LSBytes) : 0x" + pad(multi_byte_value.toString(16),6));
            ScanaStudio.dec_item_add_content("0x" + pad(multi_byte_value.toString(16),6));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Trip Run Time",
                ("(LSBytes) : 0x" + pad(multi_byte_value.toString(16),6)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 14 :
        {
            ScanaStudio.dec_item_new(decoder_items.channel_index, decoder_items.start_sample_index, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Trip Run Time (MSByte) : 0x" + pad(hex_value.toString(16),2));
            ScanaStudio.dec_item_add_content("0x" + pad(hex_value.toString(16),2));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                decoder_items.end_sample_index,
                "Trip Run Time",
                ("(MSByte) : 0x" + pad(hex_value.toString(16),2)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        default :
        {
            packet_title = "Filled Data";
            if (hex_value == 255)
            {
                item_content = "Filled with 0xFF";
            }
            else
            {
                item_content = "0x" + pad(hex_value.toString(16),2) + ", should be 0xFF";
                types_title = ScanaStudio.PacketColors.Error.Title;
                types_content = ScanaStudio.PacketColors.Error.Content;
            }
        }
    }//end switch (byte)
}//end function Trip_parameters_Vessel

function Trip_parameters_Engine (decoder_items) //127497
{
    var str = "";
    switch (fast_packet_byte)
    {
        case 1 :
        {
            str = LOOKUP_ENGINE_INSTANCE(hex_value);
            item_content = "Instance : " + str;
            break;
        }
        case 2 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 3 :
        {
            multi_byte_value += (hex_value<<8);
            ScanaStudio.dec_item_new(decoder_items.channel_index, start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Trip Fuel Used : " + multi_byte_value + " L");
            ScanaStudio.dec_item_add_content(multi_byte_value + " L");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("Trip Fuel Used : " + multi_byte_value + " L"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 4 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 5 :
        {
            multi_byte_value += (hex_value<<8);
            multi_byte_value = multi_byte_value*0.1;
            ScanaStudio.dec_item_new(decoder_items.channel_index, start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Fuel Rate, Average : " + multi_byte_value.toFixed(1) + " L/h");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(1) + " L/h");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Fuel Rate",
                ("Average : " + multi_byte_value.toFixed(1) + " L/h"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 6 :
        {
            ScanaStudio.dec_item_new(decoder_items.channel_index, decoder_items.start_sample_index, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Fuel Rate, Economy (LSByte) : 0x" + pad(hex_value.toString(16),2));
            ScanaStudio.dec_item_add_content("(LSByte) : 0x" + pad(hex_value.toString(16),2));
            ScanaStudio.dec_item_add_content("0x" + pad(hex_value.toString(16),2));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                decoder_items.end_sample_index,
                "Fuel Rate",
                ("Economy (LSByte) : 0x" + pad(hex_value.toString(16),2)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 7 :
        {
            ScanaStudio.dec_item_new(decoder_items.channel_index, decoder_items.start_sample_index, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Fuel Rate, Economy (MSByte) : 0x" + pad(hex_value.toString(16),2));
            ScanaStudio.dec_item_add_content("(MSByte) : 0x" + pad(hex_value.toString(16),2));
            ScanaStudio.dec_item_add_content("0x" + pad(hex_value.toString(16),2));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                decoder_items.end_sample_index,
                "Fuel Rate",
                ("Economy (MSByte) : 0x" + pad(hex_value.toString(16),2)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 8 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 9 :
        {
            multi_byte_value += (hex_value<<8);
            multi_byte_value = multi_byte_value*0.1;
            ScanaStudio.dec_item_new(decoder_items.channel_index, start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Instantaneous Fuel Economy : " + multi_byte_value.toFixed(1) + " L/h");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(1) + " L/h");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Instantaneous",
                ("Fuel Economy : " + multi_byte_value.toFixed(1) + " L/h"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        default :
        {
            packet_title = "Filled Data";
            if (hex_value == 255)
            {
                item_content = "Filled with 0xFF";
            }
            else
            {
                item_content = "0x" + pad(hex_value.toString(16),2) + ", should be 0xFF";
                types_title = ScanaStudio.PacketColors.Error.Title;
                types_content = ScanaStudio.PacketColors.Error.Content;
            }
        }
    }//end switch (byte)
}//end function Trip_parameters_Engine

function Trip_parameters_Static (decoder_items) //127498
{
    var str = "";
    switch (fast_packet_byte)
    {
        case 1 :
        {
            str = LOOKUP_ENGINE_INSTANCE(hex_value);
            item_content = "Instance : " + str;
            break;
        }
        case 2 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 3 :
        {
            multi_byte_value += (hex_value<<8);
            multi_byte_value = multi_byte_value*0.25;
            ScanaStudio.dec_item_new(decoder_items.channel_index, start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Rated Engine Speed : " + multi_byte_value.toFixed(2) + " rpm");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(2) + " rpm");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Rated Engine ",
                ("Speed : " +  multi_byte_value.toFixed(2) + " rpm"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 4 :
        case 5 :
        case 6 :
        case 7 :
        case 8 :
        case 9 :
        case 10:
        case 11:
        case 12:
        case 13:
        case 14:
        case 15:
        case 16:
        case 17:
        case 18:
        case 19:
        case 20:
        {
            item_content = "VIN : " + "'" + String.fromCharCode(hex_value) + "'";
            break;
        }
        case 21 :
        case 22 :
        case 23 :
        case 24 :
        case 25 :
        case 26 :
        case 27 :
        case 28 :
        case 29 :
        case 30 :
        case 31 :
        case 32 :
        case 33 :
        case 34 :
        case 35 :
        case 36 :
        case 37 :
        case 38 :
        case 39 :
        case 40 :
        case 41 :
        case 42 :
        case 43 :
        case 44 :
        case 45 :
        case 46 :
        case 47 :
        case 48 :
        case 49 :
        case 50 :
        case 51 :
        case 52 :
        {
            item_content = "Software ID : " + "'" + String.fromCharCode(hex_value) + "'";
            break;
        }
        default :
        {
            packet_title = "Filled Data";
            if (hex_value == 255)
            {
                item_content = "Filled with 0xFF";
            }
            else
            {
                item_content = "0x" + pad(hex_value.toString(16),2) + ", should be 0xFF";
                types_title = ScanaStudio.PacketColors.Error.Title;
                types_content = ScanaStudio.PacketColors.Error.Content;
            }
        }
    }//end switch (byte)
}//end function Trip_parameters_Static

function Load_Controller_Connection_State_Control (decoder_items) //127500
{
    var str = "";
    switch (fast_packet_byte)
    {
        case 1 :
        {
            item_content = "Sequence ID : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 2 :
        {
            item_content = "Connection ID : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 3 :
        {
            item_content = "State : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 4 :
        {
            item_content = "Status : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 5 :
        {
            item_content = "Operational Status & Control : 0x" + pad(hex_value.toString(16),2);
            ScanaStudio.dec_item_new(decoder_items.channel_index, decoder_items.start_sample_index, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Operational Status & Control : 0x" + pad(hex_value.toString(16),2));
            ScanaStudio.dec_item_add_content("0x" + pad(multi_byte_value.toString(16),2));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                decoder_items.end_sample_index,
                "Operational",
                ("Status & Control : 0x" + pad(hex_value.toString(16),2)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 6 :
        {
            item_content = "PWM Duty Cycle : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 7 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 8 :
        {
            multi_byte_value += (hex_value<<8);
            ScanaStudio.dec_item_new(decoder_items.channel_index, start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("TimeON : 0x" + pad(multi_byte_value.toString(16),2));
            ScanaStudio.dec_item_add_content("0x" + pad(multi_byte_value.toString(16),2));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("TimeON : 0x" + pad(multi_byte_value.toString(16),2)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 9 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 10 :
        {
            multi_byte_value += (hex_value<<8);
            ScanaStudio.dec_item_new(decoder_items.channel_index, start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("TimeOFF : 0x" + pad(multi_byte_value.toString(16),2));
            ScanaStudio.dec_item_add_content("0x" + pad(multi_byte_value.toString(16),2));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("TimeOFF : 0x" + pad(multi_byte_value.toString(16),2)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        default :
        {
            packet_title = "Filled Data";
            if (hex_value == 255)
            {
                item_content = "Filled with 0xFF";
            }
            else
            {
                item_content = "0x" + pad(hex_value.toString(16),2) + ", should be 0xFF";
                types_title = ScanaStudio.PacketColors.Error.Title;
                types_content = ScanaStudio.PacketColors.Error.Content;
            }
        }
    }//end switch (byte)
}//end function Load_Controller_Connection_State_Control

function Distance_Log (decoder_items) //128275
{
    var str = "";
    switch (fast_packet_byte)
    {
        case 1 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 2 :
        {
            multi_byte_value += (hex_value<<8);
            system_time.setTime((multi_byte_value)*1000*24*3600);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Date : " + system_time.getMonth() + "/" + system_time.getDate() + "/" + system_time.getFullYear() + " (month/day/year)");
            ScanaStudio.dec_item_add_content("Date : " + system_time.getMonth() + "/" + system_time.getDate() + "/" + system_time.getFullYear());
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("Date : " + system_time.getMonth() + "/" + system_time.getDate() + "/" + system_time.getFullYear() + " (m/d/y)"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 3 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 4 :
        {
            multi_byte_value += (hex_value<<8);
            skip_item = true;
            break;
        }
        case 5 :
        {
            multi_byte_value += (hex_value<<16);
            skip_item = true;
            break;
        }
        case 6 :
        {
            multi_byte_value += hex_value*Math.pow(2,24);
            system_time.setTime((multi_byte_value/10)-(3600*1000)); // the Date object is initialize the 1 january, 1970 at 1am
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Time : " + system_time.getHours() + "h" + system_time.getMinutes() + "min" + system_time.getSeconds() + "sec");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("Time : " + system_time.getHours() + "h" + system_time.getMinutes() + "min" + system_time.getSeconds() + "sec"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 7 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 8 :
        {
            multi_byte_value += (hex_value<<8);
            skip_item = true;
            break;
        }
        case 9 :
        {
            multi_byte_value += (hex_value<<16);
            skip_item = true;
            break;
        }
        case 10 :
        {
            multi_byte_value += hex_value*Math.pow(2,24);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Log : " + multi_byte_value.toString().replace(/(\d)(?=(\d{3})+\b)/g,'$1 ') + " m");
            ScanaStudio.dec_item_add_content(multi_byte_value.toString().replace(/(\d)(?=(\d{3})+\b)/g,'$1 ') + " m");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("Log : " + multi_byte_value.toString().replace(/(\d)(?=(\d{3})+\b)/g,'$1 ') + " m"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 11 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 12 :
        {
            multi_byte_value += (hex_value<<8);
            skip_item = true;
            break;
        }
        case 13 :
        {
            multi_byte_value += (hex_value<<16);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Trig Log (LSBytes) : 0x" + pad(multi_byte_value.toString(16),6));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("Trig Log (LSBytes) : 0x" + pad(multi_byte_value.toString(16),6)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 14 :
        {
            item_content = "Trig Log (MSByte) : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        default :
        {
            packet_title = "Filled Data";
            if (hex_value == 255)
            {
                item_content = "Filled with 0xFF";
            }
            else
            {
                item_content = "0x" + pad(hex_value.toString(16),2) + ", should be 0xFF";
                types_title = ScanaStudio.PacketColors.Error.Title;
                types_content = ScanaStudio.PacketColors.Error.Content;
            }
        }
    }//end switch (byte)
}//end function Distance_Log

function AIS_Class_A_Position_Report (decoder_items) //129038
{
    var str = "";
    switch (fast_packet_byte)
    {
        case 1 :
        {
            var message_id = hex_value>>2;
            var repeat_indicator = hex_value&0x3;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/4*3;
            ScanaStudio.dec_item_new(decoder_items.channel_index,decoder_items.start_sample_index, end_item);
            ScanaStudio.dec_item_add_content("Message ID : 0x" + pad(message_id.toString(16),2));
            ScanaStudio.dec_item_add_content("0x" + pad(message_id.toString(16),2));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                end_item,
                "Fast Packet Data",
                ("Message ID : 0x" + pad(message_id.toString(16),2)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            str = LOOKUP_REPEAT_INDICATOR(repeat_indicator);
            ScanaStudio.dec_item_new(decoder_items.channel_index, end_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Repeat Indicator : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                end_item,
                decoder_items.end_sample_index,
                "Repeat Indicator",
                (str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 2 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value
            skip_item = true;
            break;
        }
        case 3 :
        {
            multi_byte_value += (hex_value<<8);
            skip_item = true;
            break;
        }
        case 4 :
        {
            multi_byte_value += (hex_value<<16);
            skip_item = true;
            break;
        }
        case 5 :
        {
            multi_byte_value += hex_value*Math.pow(2,24);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("User ID : 0x" + pad(multi_byte_value.toString(16),8));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("User ID : 0x" + pad(multi_byte_value.toString(16),8)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 6 :
        {
            item_content = "Longitude (LSByte) : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 7 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 8 :
        {
            multi_byte_value += (hex_value<<8);
            skip_item = true;
            break;
        }
        case 9 :
        {
            multi_byte_value += (hex_value<<16);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Longitude (MSBytes) : 0x" + pad(multi_byte_value.toString(16),6));
            ScanaStudio.dec_item_add_content("0x" + pad(multi_byte_value.toString(16),6));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("Longitude (MSBytes) : 0x" + pad(multi_byte_value.toString(16),6)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 10 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 11 :
        {
            multi_byte_value += (hex_value<<8);
            skip_item = true;
            break;
        }
        case 12 :
        {
            multi_byte_value += (hex_value<<16);
            skip_item = true;
            break;
        }
        case 13 :
        {
            multi_byte_value += hex_value*Math.pow(2,24);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Latitude : 0x" + pad(multi_byte_value.toString(16),8));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("Latitude : 0x" + pad(multi_byte_value.toString(16),8)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 14 :
        {
            var position_accuracy = hex_value>>7;
            var RAIM = (hex_value>>6)&0x1;
            var time_stamp = hex_value&0x3F;
            str = LOOKUP_POSITION_ACCURACY(position_accuracy);
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/8;
            ScanaStudio.dec_item_new(decoder_items.channel_index,decoder_items.start_sample_index, end_item);
            ScanaStudio.dec_item_add_content("Position Accuracy : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                end_item,
                "Fast Packet Data",
                ("Position Accuracy : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            str = LOOKUP_RAIM_FLAG(RAIM);
            start_item = end_item;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/4;
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item, end_item);
            ScanaStudio.dec_item_add_content("RAIM : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("RAIM : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            str = LOOKUP_TIME_STAMP(time_stamp);
            ScanaStudio.dec_item_new(decoder_items.channel_index,end_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Time Stamp : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                end_item,
                decoder_items.end_sample_index,
                "Time Stamp",
                (str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 15 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 16 :
        {
            multi_byte_value += (hex_value<<8);
            multi_byte_value = multi_byte_value/10000;
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("COG : " + multi_byte_value.toFixed(5) + " rad");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(5) + " rad");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("COG : " + multi_byte_value.toFixed(5) + " rad"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 17 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 18 :
        {
            multi_byte_value += (hex_value<<8);
            multi_byte_value = multi_byte_value*0.01;
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("SOG : " + multi_byte_value.toFixed(2) + " m/s");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(2) + " m/s");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("SOG : " + multi_byte_value.toFixed(2) + " m/s"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 19 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 20 :
        {
            multi_byte_value += (hex_value<<8);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Communication State (LSBytes) : 0x" + pad(multi_byte_value.toString(16),4));
            ScanaStudio.dec_item_add_content("0x" + pad(multi_byte_value.toString(16),4));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Communication ",
                ("State (LSBytes) : 0x" + pad(multi_byte_value.toString(16),4)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 21 :
        {
            var end_communication_state = hex_value>>5;
            var ais_transceiver_information = (hex_value)&0x1F;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/8*3;
            ScanaStudio.dec_item_new(decoder_items.channel_index,decoder_items.start_sample_index, end_item);
            ScanaStudio.dec_item_add_content("Communication State (MSByte) : 0x" + pad(end_communication_state.toString(16),2));
            ScanaStudio.dec_item_add_content("0x" + pad(end_communication_state.toString(16),2));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                end_item,
                "Communication ",
                ("State (MSByte) : 0x" + pad(end_communication_state.toString(16),2)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            str = LOOKUP_AIS_TRANSCEIVER(ais_transceiver_information);
            ScanaStudio.dec_item_new(decoder_items.channel_index,end_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("AIS Transceiver information : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                end_item,
                decoder_items.end_sample_index,
                "AIS Transceiver",
                ("Info : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 22 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 23 :
        {
            multi_byte_value += (hex_value<<8);
            multi_byte_value = multi_byte_value/10000;
            ScanaStudio.dec_item_new(decoder_items.channel_index, start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Heading : " + multi_byte_value.toFixed(4) + " rad");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(4) + " rad");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("Heading : " + multi_byte_value.toFixed(4) + " rad"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 24 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 25 :
        {
            multi_byte_value += (hex_value<<8);
            multi_byte_value = multi_byte_value/(1000000*32);
            ScanaStudio.dec_item_new(decoder_items.channel_index, start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Rate of Turn : " + multi_byte_value.toFixed(8) + " rad/s");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(8) + " rad/s");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Rate of Turn",
                (multi_byte_value.toFixed(8) + " rad/s"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 26 :
        {
            var nav_status = hex_value>>4;
            var special_maneuver_indicator = (hex_value>>2)&0x3;
            var reserved = hex_value&0x3;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/2;
            str = LOOKUP_NAV_STATUS(nav_status);
            ScanaStudio.dec_item_new(decoder_items.channel_index, decoder_items.start_sample_index, end_item);
            ScanaStudio.dec_item_add_content("Nav Status : " + str);
            ScanaStudio.dec_item_add_content("" + str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                end_item,
                "Nav Status",
                (str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            start_item = end_item;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/4*3;
            str = LOOKUP_AIS_SPECIAL_MANEUVER(special_maneuver_indicator);
            ScanaStudio.dec_item_new(decoder_items.channel_index, start_item, end_item);
            ScanaStudio.dec_item_add_content("Special Maneuver Indicator : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                end_item,
                "Spec Maneuver Ind",
                (str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            ScanaStudio.dec_item_new(decoder_items.channel_index, end_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Reserved : 0x" + pad(reserved.toString(16),1));
            ScanaStudio.dec_item_add_content("0x" + pad(reserved.toString(16),1));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                end_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("Reserved : 0x" + pad(reserved.toString(16),1)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 27 :
        {
            var ais_spare = hex_value>>5;
            var reserved = hex_value&0x1F;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/2;
            ScanaStudio.dec_item_new(decoder_items.channel_index, decoder_items.start_sample_index, end_item);
            ScanaStudio.dec_item_add_content("AIS Spare : 0x" + pad(ais_spare.toString(16),1));
            ScanaStudio.dec_item_add_content("0x" + pad(ais_spare.toString(16),1));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                end_item,
                "Fast Packet Data",
                ("AIS Spare : 0x" + pad(ais_spare.toString(16),1)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            ScanaStudio.dec_item_new(decoder_items.channel_index, end_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Reserved : 0x" + pad(reserved.toString(16),2));
            ScanaStudio.dec_item_add_content("0x" + pad(reserved.toString(16),2));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                end_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("Reserved : 0x" + pad(reserved.toString(16),2)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 28 :
        {
            item_content = "Sequence ID : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        default :
        {
            packet_title = "Filled Data";
            if (hex_value == 255)
            {
                item_content = "Filled with 0xFF";
            }
            else
            {
                item_content = "0x" + pad(hex_value.toString(16),2) + ", should be 0xFF";
                types_title = ScanaStudio.PacketColors.Error.Title;
                types_content = ScanaStudio.PacketColors.Error.Content;
            }
        }
    }//end switch (byte)
}//end function AIS_Class_A_Position_Report

function AIS_Class_B_Position_Report (decoder_items) //129039
{
    var str = "";
    switch (fast_packet_byte)
    {
        case 1 :
        {
            var message_id = hex_value>>2;
            var repeat_indicator = hex_value&0x3;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/4*3;
            ScanaStudio.dec_item_new(decoder_items.channel_index,decoder_items.start_sample_index, end_item);
            ScanaStudio.dec_item_add_content("Message ID : 0x" + pad(message_id.toString(16),2));
            ScanaStudio.dec_item_add_content("0x" + pad(message_id.toString(16),2));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                end_item,
                "Fast Packet Data",
                ("Message ID : 0x" + pad(message_id.toString(16),2)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            str = LOOKUP_REPEAT_INDICATOR(repeat_indicator);
            ScanaStudio.dec_item_new(decoder_items.channel_index, end_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Repeat Indicator : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                end_item,
                decoder_items.end_sample_index,
                "Repeat Indicator",
                (str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 2 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value
            skip_item = true;
            break;
        }
        case 3 :
        {
            multi_byte_value += (hex_value<<8);
            skip_item = true;
            break;
        }
        case 4 :
        {
            multi_byte_value += (hex_value<<16);
            skip_item = true;
            break;
        }
        case 5 :
        {
            multi_byte_value += hex_value*Math.pow(2,24);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("User ID : 0x" + pad(multi_byte_value.toString(16),8));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("User ID : 0x" + pad(multi_byte_value.toString(16),8)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 6 :
        {
            item_content = "Longitude (LSByte) : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 7 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 8 :
        {
            multi_byte_value += (hex_value<<8);
            skip_item = true;
            break;
        }
        case 9 :
        {
            multi_byte_value += (hex_value<<16);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Longitude (MSBytes) : 0x" + pad(multi_byte_value.toString(16),6));
            ScanaStudio.dec_item_add_content("0x" + pad(multi_byte_value.toString(16),6));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("Longitude (MSBytes) : 0x" + pad(multi_byte_value.toString(16),6)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 10 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 11 :
        {
            multi_byte_value += (hex_value<<8);
            skip_item = true;
            break;
        }
        case 12 :
        {
            multi_byte_value += (hex_value<<16);
            skip_item = true;
            break;
        }
        case 13 :
        {
            multi_byte_value += hex_value*Math.pow(2,24);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Latitude : 0x" + pad(multi_byte_value.toString(16),8));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("Latitude : 0x" + pad(multi_byte_value.toString(16),8)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 14 :
        {
            var position_accuracy = hex_value>>7;
            var RAIM = (hex_value>>6)&0x1;
            var time_stamp = hex_value&0x3F;
            str = LOOKUP_POSITION_ACCURACY(position_accuracy);
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/8;
            ScanaStudio.dec_item_new(decoder_items.channel_index,decoder_items.start_sample_index, end_item);
            ScanaStudio.dec_item_add_content("Position Accuracy : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                end_item,
                "Fast Packet Data",
                ("Position Accuracy : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            str = LOOKUP_RAIM_FLAG(RAIM);
            start_item = end_item;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/4;
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item, end_item);
            ScanaStudio.dec_item_add_content("RAIM : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("RAIM : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            str = LOOKUP_TIME_STAMP(time_stamp);
            ScanaStudio.dec_item_new(decoder_items.channel_index,end_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Time Stamp : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                end_item,
                decoder_items.end_sample_index,
                "Time Stamp",
                (str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 15 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 16 :
        {
            multi_byte_value += (hex_value<<8);
            multi_byte_value = multi_byte_value/10000;
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("COG : " + multi_byte_value.toFixed(5) + " rad");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(5) + " rad");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("COG : " + multi_byte_value.toFixed(5) + " rad"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 17 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 18 :
        {
            multi_byte_value += (hex_value<<8);
            multi_byte_value = multi_byte_value*0.01;
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("SOG : " + multi_byte_value.toFixed(2) + " m/s");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(2) + " m/s");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("SOG : " + multi_byte_value.toFixed(2) + " m/s"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 19 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 20 :
        {
            multi_byte_value += (hex_value<<8);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Communication State (LSBytes) : 0x" + pad(multi_byte_value.toString(16),4));
            ScanaStudio.dec_item_add_content("0x" + pad(multi_byte_value.toString(16),4));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Communication",
                ("State (LSBytes) : 0x" + pad(multi_byte_value.toString(16),4)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 21 :
        {
            var end_communication_state = hex_value>>5;
            var ais_transceiver_information = (hex_value)&0x1F;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/8*3;
            ScanaStudio.dec_item_new(decoder_items.channel_index,decoder_items.start_sample_index, end_item);
            ScanaStudio.dec_item_add_content("Communication State (MSByte) : 0x" + pad(end_communication_state.toString(16),2));
            ScanaStudio.dec_item_add_content("0x" + pad(end_communication_state.toString(16),2));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                end_item,
                "Communication",
                ("State (MSByte) : 0x" + pad(end_communication_state.toString(16),2)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            str = LOOKUP_AIS_TRANSCEIVER(ais_transceiver_information);
            ScanaStudio.dec_item_new(decoder_items.channel_index,end_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("AIS Transceiver information : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                end_item,
                decoder_items.end_sample_index,
                "AIS Transceiver",
                ("Info : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 22 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 23 :
        {
            multi_byte_value += (hex_value<<8);
            multi_byte_value = multi_byte_value/10000;
            ScanaStudio.dec_item_new(decoder_items.channel_index, start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Heading : " + multi_byte_value.toFixed(4) + " rad");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(4) + " rad");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("Heading : " + multi_byte_value.toFixed(4) + " rad"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 24 :
        {
            item_content = "Regional Application : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 25 :
        {
            var regional_application = hex_value>>6;
            var unit_type = (hex_value>>5)&0x1;
            var integrated_display = (hex_value>>4)&0x1;
            var DSC = (hex_value>>3)&0x1;
            var band = (hex_value>>2)&0x1;
            var can_handle_msg = (hex_value>>1)&0x1;
            var ais_mode = hex_value&0x1;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/4;
            // Regional Application
            ScanaStudio.dec_item_new(decoder_items.channel_index, decoder_items.start_sample_index, end_item);
            ScanaStudio.dec_item_add_content("Regional Application : 0x" + pad(regional_application.toString(16),1));
            ScanaStudio.dec_item_add_content("0x" + pad(regional_application.toString(16),1));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                end_item,
                "Fast Packet Data",
                ("Regional Application : 0x" + pad(regional_application.toString(16),1)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            // Unit_type
            start_item = end_item;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/8*3;
            switch (unit_type)
            {
                case 0 :
                {
                    str = "SOTDMA"
                    break;
                }
                case 1 :
                {
                    str = "CS"
                    break;
                }
            }
            ScanaStudio.dec_item_new(decoder_items.channel_index, start_item, end_item);
            ScanaStudio.dec_item_add_content("Unit type : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                end_item,
                "Fast Packet Data",
                ("Unit type : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            // Integrated display
            start_item = end_item;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/8*4;
            str = LOOKUP_YES_NO(integrated_display);
            ScanaStudio.dec_item_new(decoder_items.channel_index, start_item, end_item);
            ScanaStudio.dec_item_add_content("Integrated display : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                end_item,
                "Fast Packet Data",
                ("Integrated display : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            // DSC
            start_item = end_item;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/8*5;
            str = LOOKUP_YES_NO(DSC);
            ScanaStudio.dec_item_new(decoder_items.channel_index, start_item, end_item);
            ScanaStudio.dec_item_add_content("DSC : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                end_item,
                "Fast Packet Data",
                ("DSC : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            // Band
            start_item = end_item;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/8*6;
            switch (band)
            {
                case 0 :
                {
                    str = "top 525 kHz of marine band";
                    break;
                }
                case 1 :
                {
                    str = "entire marine band";
                    break;
                }
            }
            ScanaStudio.dec_item_new(decoder_items.channel_index, start_item, end_item);
            ScanaStudio.dec_item_add_content("Band : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                end_item,
                "       Band",
                (str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            // Handle Msg 22
            start_item = end_item;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/8*7;
            str = LOOKUP_YES_NO(can_handle_msg);
            ScanaStudio.dec_item_new(decoder_items.channel_index, start_item, end_item);
            ScanaStudio.dec_item_add_content("Can handle Msg 22 : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                end_item,
                "Fast Packet Data",
                ("Can handle Msg 22 : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            // AIS mode
            start_item = end_item;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index);
            switch (ais_mode)
            {
                case 0 :
                {
                    str = "Autonomous";
                    break;
                }
                case 1 :
                {
                    str = "Assigned";
                    break;
                }
            }
            ScanaStudio.dec_item_new(decoder_items.channel_index, start_item, end_item);
            ScanaStudio.dec_item_add_content("AIS mode : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                end_item,
                "Fast Packet Data",
                ("AIS mode : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 26 :
        {
            var ais_communication_state = hex_value>>7;
            var reserved = hex_value&0x7F;
            switch (ais_communication_state)
            {
                case 0 :
                {
                    str = "SOTDMA";
                    break;
                }
                case 1 :
                {
                    str = "ITDMA";
                    break;
                }
            }
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/8;
            ScanaStudio.dec_item_new(decoder_items.channel_index, decoder_items.start_sample_index, end_item);
            ScanaStudio.dec_item_add_content("AIS communication state : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                end_item,
                "       AIS       ",
                ("Communication state : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            ScanaStudio.dec_item_new(decoder_items.channel_index, end_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Reserved : 0x" + pad(reserved.toString(16),2));
            ScanaStudio.dec_item_add_content("Reserved");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                end_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("Reserved : 0x" + pad(reserved.toString(16),2)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        default :
        {
            packet_title = "Filled Data";
            if (hex_value == 255)
            {
                item_content = "Filled with 0xFF";
            }
            else
            {
                item_content = "0x" + pad(hex_value.toString(16),2) + ", should be 0xFF";
                types_title = ScanaStudio.PacketColors.Error.Title;
                types_content = ScanaStudio.PacketColors.Error.Content;
            }
        }
    }//end switch (byte)
}//end function AIS_Class_B_Position_Report

function AIS_Class_B_Extended_Position_Report (decoder_items) //129040
{
    var str = "";
    switch (fast_packet_byte)
    {
        case 1 :
        {
            var message_id = hex_value>>2;
            var repeat_indicator = hex_value&0x3;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/4*3;
            ScanaStudio.dec_item_new(decoder_items.channel_index,decoder_items.start_sample_index, end_item);
            ScanaStudio.dec_item_add_content("Message ID : 0x" + pad(message_id.toString(16),2));
            ScanaStudio.dec_item_add_content("0x" + pad(message_id.toString(16),2));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                end_item,
                "Fast Packet Data",
                ("Message ID : 0x" + pad(message_id.toString(16),2)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            str = LOOKUP_REPEAT_INDICATOR(repeat_indicator);
            ScanaStudio.dec_item_new(decoder_items.channel_index, end_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Repeat Indicator : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                end_item,
                decoder_items.end_sample_index,
                "Repeat Indicator",
                (str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 2 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value
            skip_item = true;
            break;
        }
        case 3 :
        {
            multi_byte_value += (hex_value<<8);
            skip_item = true;
            break;
        }
        case 4 :
        {
            multi_byte_value += (hex_value<<16);
            skip_item = true;
            break;
        }
        case 5 :
        {
            multi_byte_value += hex_value*Math.pow(2,24);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("User ID : 0x" + pad(multi_byte_value.toString(16),8));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("User ID : 0x" + pad(multi_byte_value.toString(16),8)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 6 :
        {
            item_content = "Longitude (LSByte) : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 7 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 8 :
        {
            multi_byte_value += (hex_value<<8);
            skip_item = true;
            break;
        }
        case 9 :
        {
            multi_byte_value += (hex_value<<16);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Longitude (MSBytes) : 0x" + pad(multi_byte_value.toString(16),6));
            ScanaStudio.dec_item_add_content("0x" + pad(multi_byte_value.toString(16),6));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("Longitude (MSBytes) : 0x" + pad(multi_byte_value.toString(16),6)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 10 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 11 :
        {
            multi_byte_value += (hex_value<<8);
            skip_item = true;
            break;
        }
        case 12 :
        {
            multi_byte_value += (hex_value<<16);
            skip_item = true;
            break;
        }
        case 13 :
        {
            multi_byte_value += hex_value*Math.pow(2,24);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Latitude : 0x" + pad(multi_byte_value.toString(16),8));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("Latitude : 0x" + pad(multi_byte_value.toString(16),8)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            break;
        }
        case 14 :
        {
            var position_accuracy = hex_value>>7;
            var RAIM = (hex_value>>6)&0x1;
            var time_stamp = hex_value&0x3F;
            str = LOOKUP_POSITION_ACCURACY(position_accuracy);
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/8;
            ScanaStudio.dec_item_new(decoder_items.channel_index,decoder_items.start_sample_index, end_item);
            ScanaStudio.dec_item_add_content("Position Accuracy : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                end_item,
                "Fast Packet Data",
                ("Position Accuracy : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            str = LOOKUP_RAIM_FLAG(RAIM);
            start_item = end_item;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/4;
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item, end_item);
            ScanaStudio.dec_item_add_content("AIS RAIM Flag : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                end_item,
                "Fast Packet Data",
                ("RAIM : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            str = LOOKUP_TIME_STAMP(time_stamp);
            ScanaStudio.dec_item_new(decoder_items.channel_index,end_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Time Stamp : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                end_item,
                decoder_items.end_sample_index,
                "Time Stamp",
                (str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 15 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 16 :
        {
            multi_byte_value += (hex_value<<8);
            multi_byte_value = multi_byte_value/10000;
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("COG : " + multi_byte_value.toFixed(5) + " rad");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(5) + " rad");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("COG : " + multi_byte_value.toFixed(5) + " rad"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 17 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 18 :
        {
            multi_byte_value += (hex_value<<8);
            multi_byte_value = multi_byte_value*0.01;
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("SOG : " + multi_byte_value.toFixed(2) + " m/s");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(2) + " m/s");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("SOG : " + multi_byte_value.toFixed(2) + " m/s"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 19 :
        {
            item_content = "Regional Application : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 20 :
        {
            var regional_application = hex_value>>4;
            var reserved = hex_value&0xF;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/2;
            // Regional Application
            ScanaStudio.dec_item_new(decoder_items.channel_index, decoder_items.start_sample_index, end_item);
            ScanaStudio.dec_item_add_content("Regional Application : 0x" + pad(regional_application.toString(16),1));
            ScanaStudio.dec_item_add_content("0x" + pad(regional_application.toString(16),1));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                end_item,
                "Fast Packet Data",
                ("Regional Application : 0x" + pad(regional_application.toString(16),1)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            // Reserved
            ScanaStudio.dec_item_new(decoder_items.channel_index, end_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Reserved : 0x" + pad(reserved.toString(16),1));
            ScanaStudio.dec_item_add_content("Reserved");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                end_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("Reserved : 0x" + pad(reserved.toString(16),1)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 21 :
        {
            str = LOOKUP_SHIP_TYPE(hex_value);
            item_content = "Type of ship : " + str;
            break;
        }
        case 22 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 23 :
        {
            multi_byte_value += (hex_value<<8);
            multi_byte_value = multi_byte_value/10000;
            ScanaStudio.dec_item_new(decoder_items.channel_index, start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("True Heading : " + multi_byte_value.toFixed(4) + " rad");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(4) + " rad");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("Heading : " + multi_byte_value.toFixed(4) + " rad"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 24 :
        {
            var reserved = hex_value>>4;
            var gnss_type = hex_value&0xF;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/2;
            ScanaStudio.dec_item_new(decoder_items.channel_index,decoder_items.start_sample_index, end_item);
            ScanaStudio.dec_item_add_content("Reserved : 0x" + pad(reserved.toString(16),1));
            ScanaStudio.dec_item_add_content("Reserved");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                end_item,
                "Fast Packet Data",
                ("Reserved : 0x" + pad(reserved.toString(16),1)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            str = LOOKUP_GNS_AIS(gnss_type);
            ScanaStudio.dec_item_new(decoder_items.channel_index,end_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("GNSS Type : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                end_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("GNSS Type : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 25 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 26 :
        {
            multi_byte_value += (hex_value<<8);
            multi_byte_value = multi_byte_value*0.1;
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Length : " + multi_byte_value.toFixed(1) + " m");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(1) + " m");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("Length : " + multi_byte_value.toFixed(1) + " m"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 27 :
        {
            item_content = "Beam (LSByte) : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 28 :
        {
            item_content = "Beam (MSByte) : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 29 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 30 :
        {
            multi_byte_value += (hex_value<<8);
            multi_byte_value = multi_byte_value*0.1;
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Position reference from Starboard : " + multi_byte_value.toFixed(1) + " m");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(1) + " m");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Position reference",
                (" from Starboard : " + multi_byte_value.toFixed(1) + " m"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 31 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 32 :
        {
            multi_byte_value += (hex_value<<8);
            multi_byte_value = multi_byte_value*0.1;
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Position reference from Bow : " + multi_byte_value.toFixed(1) + " m");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(1) + " m");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Position reference",
                (" from Bow : " + multi_byte_value.toFixed(1) + " m"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 33 :
        case 34 :
        case 35 :
        case 36 :
        case 37 :
        case 38 :
        case 39 :
        case 40 :
        case 41 :
        case 42 :
        case 43 :
        case 44 :
        case 45 :
        case 46 :
        case 47 :
        case 48 :
        case 49 :
        case 50 :
        case 51 :
        case 52 :
        {
            item_content = "Name : " + "'" + String.fromCharCode(hex_value) + "'";
            break;
        }
        case 53 :
        {
            var DTE = hex_value>>7;
            var ais_mode = (hex_value>>6)&0x1;
            var reserved = (hex_value>>2)&0x3;
            var ais_transceiver_information = hex_value&0x3;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/8;
            switch (DTE)
            {
                case 0 :
                {
                    str = "Available";
                    break;
                }
                case 1 :
                {
                    str = "Not Available";
                    break;
                }
            }
            ScanaStudio.dec_item_new(decoder_items.channel_index, decoder_items.start_sample_index, end_item);
            ScanaStudio.dec_item_add_content("DTE : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                end_item,
                "Fast Packet Data",
                ("DTE : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            start_item = end_item;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/4;
            switch (ais_mode)
            {
                case 0 :
                {
                    str = "Autonomous";
                    break;
                }
                case 1 :
                {
                    str = "Assigned";
                    break;
                }
            }
            ScanaStudio.dec_item_new(decoder_items.channel_index, start_item, end_item);
            ScanaStudio.dec_item_add_content("AIS mode : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                end_item,
                "Fast Packet Data",
                ("AIS mode : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            start_item = end_item;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/4*3;
            ScanaStudio.dec_item_new(decoder_items.channel_index, start_item, end_item);
            ScanaStudio.dec_item_add_content("Reserved : 0x" + pad(reserved.toString(16),1));
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                end_item,
                "Fast Packet Data",
                ("Reserved : 0x" + pad(reserved.toString(16),1)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            ScanaStudio.dec_item_new(decoder_items.channel_index, end_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("AIS Transceiver information : 0b" + pad(ais_transceiver_information.toString(2),2));
            ScanaStudio.dec_item_add_content("0b" + pad(ais_transceiver_information.toString(2),2));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                end_item,
                decoder_items.end_sample_index,
                "       AIS ",
                ("Transceiver information : 0b" + pad(ais_transceiver_information.toString(2),2)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 54 :
        {
            var ais_transceiver_information = (hex_value>>5)&0x3;
            var reserved = hex_value&0x1F;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/8*3;
            ScanaStudio.dec_item_new(decoder_items.channel_index, decoder_items.start_sample_index, end_item);
            ScanaStudio.dec_item_add_content("AIS Transceiver information : 0b" + pad(ais_transceiver_information.toString(2),3));
            ScanaStudio.dec_item_add_content("0b" + pad(ais_transceiver_information.toString(2),3));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                end_item,
                "AIS Transceiver",
                ("Information : 0b" + pad(ais_transceiver_information.toString(2),3)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            ScanaStudio.dec_item_new(decoder_items.channel_index, end_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Reserved : 0x" + pad(reserved.toString(16),2));
            ScanaStudio.dec_item_add_content("Reserved");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                end_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("Reserved : 0x" + pad(reserved.toString(16),2)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        default :
        {
            packet_title = "Filled Data";
            if (hex_value == 255)
            {
                item_content = "Filled with 0xFF";
            }
            else
            {
                item_content = "0x" + pad(hex_value.toString(16),2) + ", should be 0xFF";
                types_title = ScanaStudio.PacketColors.Error.Title;
                types_content = ScanaStudio.PacketColors.Error.Content;
            }
        }
    }//end switch (byte)
}//end function AIS_Class_B_Extended_Position_Report

function AIS_Aids_to_Navigation_Report (decoder_items) //129041
{
    var str = "";
    switch (fast_packet_byte)
    {
        case 1 :
        {
            var message_id = hex_value>>2;
            var repeat_indicator = hex_value&0x3;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/4*3;
            ScanaStudio.dec_item_new(decoder_items.channel_index,decoder_items.start_sample_index, end_item);
            ScanaStudio.dec_item_add_content("Message ID : 0x" + pad(message_id.toString(16),2));
            ScanaStudio.dec_item_add_content("0x" + pad(message_id.toString(16),2));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                end_item,
                "Fast Packet Data",
                ("Message ID : 0x" + pad(message_id.toString(16),2)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            str = LOOKUP_REPEAT_INDICATOR(repeat_indicator);
            ScanaStudio.dec_item_new(decoder_items.channel_index, end_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Repeat Indicator : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                end_item,
                decoder_items.end_sample_index,
                "Repeat Indicator",
                (str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 2 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value
            skip_item = true;
            break;
        }
        case 3 :
        {
            multi_byte_value += (hex_value<<8);
            skip_item = true;
            break;
        }
        case 4 :
        {
            multi_byte_value += (hex_value<<16);
            skip_item = true;
            break;
        }
        case 5 :
        {
            multi_byte_value += hex_value*Math.pow(2,24);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("User ID : 0x" + pad(multi_byte_value.toString(16),8));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("User ID : 0x" + pad(multi_byte_value.toString(16),8)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 6 :
        {
            item_content = "Longitude (LSByte) : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 7 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 8 :
        {
            multi_byte_value += (hex_value<<8);
            skip_item = true;
            break;
        }
        case 9 :
        {
            multi_byte_value += (hex_value<<16);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Longitude (MSBytes) : 0x" + pad(multi_byte_value.toString(16),6));
            ScanaStudio.dec_item_add_content("0x" + pad(multi_byte_value.toString(16),6));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("Longitude (MSBytes) : 0x" + pad(multi_byte_value.toString(16),6)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 10 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 11 :
        {
            multi_byte_value += (hex_value<<8);
            skip_item = true;
            break;
        }
        case 12 :
        {
            multi_byte_value += (hex_value<<16);
            skip_item = true;
            break;
        }
        case 13 :
        {
            multi_byte_value += hex_value*Math.pow(2,24);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Latitude : 0x" + pad(multi_byte_value.toString(16),8));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("Latitude : 0x" + pad(multi_byte_value.toString(16),8)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 14 :
        {
            var position_accuracy = hex_value>>7;
            var RAIM = (hex_value>>6)&0x1;
            var time_stamp = hex_value&0x3F;
            str = LOOKUP_POSITION_ACCURACY(position_accuracy);
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/8;
            ScanaStudio.dec_item_new(decoder_items.channel_index,decoder_items.start_sample_index, end_item);
            ScanaStudio.dec_item_add_content("Position Accuracy : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                end_item,
                "Fast Packet Data",
                ("Position Accuracy : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            str = LOOKUP_RAIM_FLAG(RAIM);
            start_item = end_item;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/4;
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item, end_item);
            ScanaStudio.dec_item_add_content("AIS RAIM Flag : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                end_item,
                "Fast Packet Data",
                ("RAIM : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            str = LOOKUP_TIME_STAMP(time_stamp);
            ScanaStudio.dec_item_new(decoder_items.channel_index,end_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Time Stamp : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                end_item,
                decoder_items.end_sample_index,
                "Time Stamp",
                (str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 15 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 16 :
        {
            multi_byte_value += (hex_value<<8);
            multi_byte_value = multi_byte_value*0.1;
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Length/Diameter : " + multi_byte_value.toFixed(1) + " m");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(1) + " m");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("Length/Diameter : " + multi_byte_value.toFixed(1) + " m"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 17 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 18 :
        {
            multi_byte_value += (hex_value<<8);
            multi_byte_value = multi_byte_value*0.1;
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Beam/Diameter : " + multi_byte_value.toFixed(1) + " m");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(1) + " m");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("Beam/Diameter : " + multi_byte_value.toFixed(1) + " m"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 19 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 20 :
        {
            multi_byte_value += (hex_value<<8);
            multi_byte_value = multi_byte_value*0.1;
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Position reference from Starboard Edge : " + multi_byte_value.toFixed(1) + " m");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(1) + " m");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Position reference",
                (" From Starboard Edge : " + multi_byte_value.toFixed(1) + " m"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 21 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 22 :
        {
            multi_byte_value += (hex_value<<8);
            multi_byte_value = multi_byte_value*0.1;
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Position reference from True North Facing Edge : " + multi_byte_value.toFixed(1) + "m");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(1) + "m");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Position reference",
                (" From True North Edge : " + multi_byte_value.toFixed(1) + "m"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 23 :
        {
            var aton_type = hex_value>>3;
            var off_position_indicator = (hex_value>>2)&0x1;
            var virtual_aton_flag = (hex_value>>1)&0x1;
            var assigned_mode_flag = (hex_value)&0x1;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/8*5;
            str = LOOKUP_ATON_TYPE(aton_type);
            ScanaStudio.dec_item_new(decoder_items.channel_index,decoder_items.start_sample_index, end_item);
            ScanaStudio.dec_item_add_content("AtoN Type : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                end_item,
                "AtoN Type",
                (str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            start_item = end_item;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/8*6;
            str = LOOKUP_YES_NO(off_position_indicator);
            ScanaStudio.dec_item_new(decoder_items.channel_index, start_item, end_item);
            ScanaStudio.dec_item_add_content("Off Position Indicator : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                end_item,
                "Fast Packet Data",
                ("Off Position Indicator : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            start_item = end_item;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/8*7;
            str = LOOKUP_YES_NO(virtual_aton_flag);
            ScanaStudio.dec_item_new(decoder_items.channel_index, start_item, end_item);
            ScanaStudio.dec_item_add_content("Virtual AtoN Flag : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                end_item,
                "Fast Packet Data",
                ("Virtual AtoN Flag : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            str = LOOKUP_AIS_ASSIGNED_MODE(assigned_mode_flag);
            ScanaStudio.dec_item_new(decoder_items.channel_index,end_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Assigned Mode Flag : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                end_item,
                decoder_items.end_sample_index,
                "Assigned Mode Flag",
                (str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 24 :
        {
            var ais_spare = hex_value>>7;
            var position_fixing_device = (hex_value>>3)&0xF;
            var reserved = (hex_value)&0x7;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/8;
            str = LOOKUP_ATON_TYPE(aton_type);
            ScanaStudio.dec_item_new(decoder_items.channel_index,decoder_items.start_sample_index, end_item);
            ScanaStudio.dec_item_add_content("AIS Spare : 0x" + pad(ais_spare.toString(16),1));
            ScanaStudio.dec_item_add_content("0x" + pad(ais_spare.toString(16),1));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                end_item,
                "Fast Packet Data",
                ("AIS Spare : 0x" + pad(ais_spare.toString(16),1)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            start_item = end_item;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/8*5;
            str = LOOKUP_POSITION_FIX_DEVICE(position_fixing_device);
            ScanaStudio.dec_item_new(decoder_items.channel_index, start_item, end_item);
            ScanaStudio.dec_item_add_content("Position Fixing Device Type : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                end_item,
                "Position Fixing",
                ("Device Type : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            ScanaStudio.dec_item_new(decoder_items.channel_index,end_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Reserved : 0x" + pad(reserved.toString(16),1));
            ScanaStudio.dec_item_add_content("Reserved");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                end_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("Reserved : 0x" + pad(reserved.toString(16),1)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 25 :
        {
            item_content = "AtoN Status : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 26 :
        {
            var ais_transceiver_information = hex_value>>3;
            var reserved = (hex_value)&0x7;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/8;
            str = LOOKUP_AIS_TRANSCEIVER(ais_transceiver_information);
            ScanaStudio.dec_item_new(decoder_items.channel_index,decoder_items.start_sample_index, end_item);
            ScanaStudio.dec_item_add_content("AIS Transceiver information : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                end_item,
                "AIS Transceiver",
                ("Info : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            ScanaStudio.dec_item_new(decoder_items.channel_index,end_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Reserved : 0x" + pad(reserved.toString(16),1));
            ScanaStudio.dec_item_add_content("Reserved");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                end_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("Reserved : 0x" + pad(reserved.toString(16),1)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 27 :
        case 28 :
        case 29 :
        case 30 :
        case 31 :
        case 32 :
        case 33 :
        case 34 :
        case 35 :
        case 36 :
        case 37 :
        case 38 :
        case 39 :
        case 40 :
        case 41 :
        case 42 :
        case 43 :
        case 44 :
        case 45 :
        case 46 :
        case 47 :
        case 48 :
        case 49 :
        case 50 :
        case 51 :
        case 52 :
        case 53 :
        case 54 :
        case 55 :
        case 56 :
        case 57 :
        case 58 :
        case 59 :
        case 60 :
        {
            item_content = "AtoN Name : " + "'" + String.fromCharCode(hex_value) + "'";
            break;
        }
        default :
        {
            packet_title = "Filled Data";
            if (hex_value == 255)
            {
                item_content = "Filled with 0xFF";
            }
            else
            {
                item_content = "0x" + pad(hex_value.toString(16),2) + ", should be 0xFF";
                types_title = ScanaStudio.PacketColors.Error.Title;
                types_content = ScanaStudio.PacketColors.Error.Content;
            }
        }
    }//end switch (byte)
}//end function AIS_Aids_to_Navigation_Report

function Datum (decoder_items) //129044
{
    var str = "";
    switch (fast_packet_byte)
    {
        case 1 :
        case 2 :
        case 3 :
        case 4 :
        {
            item_content = "Local Datum : " + "'" + String.fromCharCode(hex_value) + "'";
            break;
        }
        case 5 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value
            skip_item = true;
            break;
        }
        case 6 :
        {
            multi_byte_value += (hex_value<<8);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Delta Latitude (LSBytes) : 0x" + pad(multi_byte_value.toString(16),4));
            ScanaStudio.dec_item_add_content("(LSBytes) : 0x" + pad(multi_byte_value.toString(16),4));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Delta Latitude ",
                ("(LSBytes) : 0x" + pad(multi_byte_value.toString(16),4)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 7 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 8 :
        {
            multi_byte_value += (hex_value<<8);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Delta Latitude (MSBytes) : 0x" + pad(multi_byte_value.toString(16),4));
            ScanaStudio.dec_item_add_content("(MSBytes) : 0x" + pad(multi_byte_value.toString(16),4));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Delta Latitude ",
                ("(MSBytes) : 0x" + pad(multi_byte_value.toString(16),4)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 9 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 10 :
        {
            multi_byte_value += (hex_value<<8);
            skip_item = true;
            break;
        }
        case 11 :
        {
            multi_byte_value += (hex_value<<16);
            skip_item = true;
            break;
        }
        case 12 :
        {
            multi_byte_value += hex_value*Math.pow(2,24);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Delta Longitude  : 0x" + pad(multi_byte_value.toString(16),8));
            ScanaStudio.dec_item_add_content("0x" + pad(multi_byte_value.toString(16),8));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("Delta Longitude  : 0x" + pad(multi_byte_value.toString(16),8)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 13 :
        {
            item_content = "Delta Altitude (LSByte) : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 14 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 15 :
        {
            multi_byte_value += (hex_value<<8);
            skip_item = true;
            break;
        }
        case 16 :
        {
            multi_byte_value += (hex_value<<16);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Delta Altitude (MSBytes) : 0x" + pad(multi_byte_value.toString(16),6));
            ScanaStudio.dec_item_add_content("0x" + pad(multi_byte_value.toString(16),6));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Delta Altitude ",
                ("(MSBytes) : 0x" + pad(multi_byte_value.toString(16),6)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 17 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_string = String.fromCharCode(hex_value);
            skip_item = true;
            break;
        }
        case 18 :
        {
            multi_byte_string = multi_byte_string + String.fromCharCode(hex_value);
            skip_item = true;
            break;
        }
        case 19 :
        {
            multi_byte_string = multi_byte_string + String.fromCharCode(hex_value);
            skip_item = true;
            break;
        }
        case 20 :
        {
            multi_byte_string = multi_byte_string + String.fromCharCode(hex_value);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Reference Datum : " + "'" + multi_byte_string + "'");
            ScanaStudio.dec_item_add_content("'" + multi_byte_string + "'");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("Reference Datum : " + "'" + multi_byte_string + "'"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        default :
        {
            packet_title = "Filled Data";
            if (hex_value == 255)
            {
                item_content = "Filled with 0xFF";
            }
            else
            {
                item_content = "0x" + pad(hex_value.toString(16),2) + ", should be 0xFF";
                types_title = ScanaStudio.PacketColors.Error.Title;
                types_content = ScanaStudio.PacketColors.Error.Content;
            }
        }
    }//end switch (byte)
}//end function Datum

function User_Datum (decoder_items) //129045
{
    var str = "";
    switch (fast_packet_byte)
    {
        case 1 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 2 :
        {
            multi_byte_value += (hex_value<<8);
            skip_item = true;
            break;
        }
        case 3 :
        {
            multi_byte_value += (hex_value<<16);
            skip_item = true;
            break;
        }
        case 4 :
        {
            multi_byte_value += hex_value*Math.pow(2,24);
            multi_byte_value = multi_byte_value*0.01;
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Delta X : " + multi_byte_value.toFixed(2).toString().replace(/(\d)(?=(\d{3})+\b)/g,'$1 ') + " m");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(2).toString().replace(/(\d)(?=(\d{3})+\b)/g,'$1 ') + " m");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("Delta X : " + multi_byte_value.toFixed(2).toString().replace(/(\d)(?=(\d{3})+\b)/g,'$1 ') + " m"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 5 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value
            skip_item = true;
            break;
        }
        case 6 :
        {
            multi_byte_value += (hex_value<<8);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Delta Y (LSBytes) : 0x" + pad(multi_byte_value.toString(16),4));
            ScanaStudio.dec_item_add_content("(LSBytes) : 0x" + pad(multi_byte_value.toString(16),4));
            ScanaStudio.dec_item_add_content("0x" + pad(multi_byte_value.toString(16),4));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("Delta Y (LSBytes) : 0x" + pad(multi_byte_value.toString(16),4)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 7 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 8 :
        {
            multi_byte_value += (hex_value<<8);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Delta Y (MSBytes) : 0x" + pad(multi_byte_value.toString(16),4));
            ScanaStudio.dec_item_add_content("(MSBytes) : 0x" + pad(multi_byte_value.toString(16),4));
            ScanaStudio.dec_item_add_content("0x" + pad(multi_byte_value.toString(16),4));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("Delta Y (MSBytes) : 0x" + pad(multi_byte_value.toString(16),4)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 9 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 10 :
        {
            multi_byte_value += (hex_value<<8);
            skip_item = true;
            break;
        }
        case 11 :
        {
            multi_byte_value += (hex_value<<16);
            skip_item = true;
            break;
        }
        case 12 :
        {
            multi_byte_value += hex_value*Math.pow(2,24);
            multi_byte_value = multi_byte_value*0.01;
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Delta Z  : " + multi_byte_value.toFixed(2).toString().replace(/(\d)(?=(\d{3})+\b)/g,'$1 ') + " m");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(2).toString().replace(/(\d)(?=(\d{3})+\b)/g,'$1 ') + " m");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("Delta Z  : " + multi_byte_value.toFixed(2).toString().replace(/(\d)(?=(\d{3})+\b)/g,'$1 ') + " m"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 13 :
        {
            item_content = "Rotation in X (LSByte) : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 14 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 15 :
        {
            multi_byte_value += (hex_value<<8);
            skip_item = true;
            break;
        }
        case 16 :
        {
            multi_byte_value += (hex_value<<16);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Rotation in X (MSBytes) : 0x" + pad(multi_byte_value.toString(16),6));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Rotation in X",
                ("(MSBytes) : 0x" + pad(multi_byte_value.toString(16),6)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 17 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 18 :
        {
            multi_byte_value += (hex_value<<8);
            skip_item = true;
            break;
        }
        case 19 :
        {
            multi_byte_value += (hex_value<<16);
            skip_item = true;
            break;
        }
        case 20 :
        {
            multi_byte_value += hex_value*Math.pow(2,24);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Rotation in Y : " + pad(multi_byte_value.toString(16),8));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Rotation in Y",
                ("0x" + pad(multi_byte_value.toString(16),8)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 21 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 22 :
        {
            multi_byte_value += (hex_value<<8);
            skip_item = true;
            break;
        }
        case 23 :
        {
            multi_byte_value += (hex_value<<16);
            skip_item = true;
            break;
        }
        case 24 :
        {
            multi_byte_value += hex_value*Math.pow(2,24);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Rotation in Z : " + pad(multi_byte_value.toString(16),8));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Rotation in Z ",
                ("0x" + pad(multi_byte_value.toString(16),8)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 25 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 26 :
        {
            multi_byte_value += (hex_value<<8);
            skip_item = true;
            break;
        }
        case 27 :
        {
            multi_byte_value += (hex_value<<16);
            ScanaStudio.dec_item_new(decoder_items.channel_index, start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Scale (LSBytes) : " + pad(multi_byte_value.toString(16),6));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("Scale (LSBytes) : " + pad(multi_byte_value.toString(16),6)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 28 :
        {
            ScanaStudio.dec_item_new(decoder_items.channel_index, decoder_items.start_sample_index, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Scale (MSByte) : " + pad(hex_value.toString(16),2));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("Scale (MSByte) : " + pad(hex_value.toString(16),2)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 29 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 30 :
        {
            multi_byte_value += (hex_value<<8);
            skip_item = true;
            break;
        }
        case 31 :
        {
            multi_byte_value += (hex_value<<16);
            skip_item = true;
            break;
        }
        case 32 :
        {
            multi_byte_value += hex_value*Math.pow(2,24);
            multi_byte_value = multi_byte_value*0.01;
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Ellipsoid Semi-major Axis : " + multi_byte_value.toFixed(2).toString().replace(/(\d)(?=(\d{3})+\b)/g,'$1 ') + " m");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Semi-major Axis",
                ("Ellipsoid : " + multi_byte_value.toFixed(2).toString().replace(/(\d)(?=(\d{3})+\b)/g,'$1 ') + " m"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 33 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 34 :
        {
            multi_byte_value += (hex_value<<8);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Ellipsoid Flattening Inverse (LSBytes) : 0x" + pad(multi_byte_value.toString(16),4));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Ellipsoid(LSBytes)",
                ("Flattening Inverse : 0x" + pad(multi_byte_value.toString(16),4)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 35 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 36 :
        {
            multi_byte_value += (hex_value<<8);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Ellipsoid Flattening Inverse (MSBytes) : 0x" + pad(multi_byte_value.toString(16),4));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Ellipsoid(MSBytes)",
                ("Flattening Inverse : 0x" + pad(multi_byte_value.toString(16),4)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 37 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_string = String.fromCharCode(hex_value);
            skip_item = true;
            break;
        }
        case 38 :
        {
            multi_byte_string = multi_byte_string + String.fromCharCode(hex_value);
            skip_item = true;
            break;
        }
        case 39 :
        {
            multi_byte_string = multi_byte_string + String.fromCharCode(hex_value);
            skip_item = true;
            break;
        }
        case 40 :
        {
            multi_byte_string = multi_byte_string + String.fromCharCode(hex_value);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Datum Name : " + "'" + multi_byte_string + "'");
            ScanaStudio.dec_item_add_content("'" + multi_byte_string + "'");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("Datum Name : " + "'" + multi_byte_string + "'"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        default :
        {
            packet_title = "Filled Data";
            if (hex_value == 255)
            {
                item_content = "Filled with 0xFF";
            }
            else
            {
                item_content = "0x" + pad(hex_value.toString(16),2) + ", should be 0xFF";
                types_title = ScanaStudio.PacketColors.Error.Title;
                types_content = ScanaStudio.PacketColors.Error.Content;
            }
        }
    }//end switch (byte)
}//end function User_Datum

function Navigation_Data (decoder_items) //129284
{
    var str = "";
    switch (fast_packet_byte)
    {
        case 1 :
        {
            item_content = "SID : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 2 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 3 :
        {
            multi_byte_value += (hex_value<<8);
            skip_item = true;
            break;
        }
        case 4 :
        {
            multi_byte_value += (hex_value<<8);
            skip_item = true;
            break;
        }
        case 5 :
        {
            multi_byte_value += hex_value*Math.pow(2,24);
            multi_byte_value = multi_byte_value*0.01;
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Distance to Waypoint : " + (multi_byte_value.toFixed(2).toString().replace(/(\d)(?=(\d{3})+\b)/g,'$1 '))  + " m");
            ScanaStudio.dec_item_add_content((multi_byte_value.toFixed(2).toString().replace(/(\d)(?=(\d{3})+\b)/g,'$1 ')) + " m");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Distance to",
                ("Waypoint : " + (multi_byte_value.toFixed(2).toString().replace(/(\d)(?=(\d{3})+\b)/g,'$1 ')) + " m"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 6 :
        {
            var course_reference = hex_value>>6;
            var perpendicular_crossed = (hex_value>>4)&0x3;
            var arrival_circuit_entered = (hex_value>>2)&0x3;
            var calculation_type = hex_value&0x3;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/4;
            str = LOOKUP_DIRECTION_REFERENCE(course_reference);
            ScanaStudio.dec_item_new(decoder_items.channel_index, decoder_items.start_sample_index, end_item);
            ScanaStudio.dec_item_add_content("Course/Bearing reference : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                end_item,
                "Course/Bearing",
                ("Reference : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            start_item = end_item;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/4*2;
            str = LOOKUP_YES_NO(perpendicular_crossed);
            ScanaStudio.dec_item_new(decoder_items.channel_index, start_item, end_item);
            ScanaStudio.dec_item_add_content("Perpendicular Crossed : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                end_item,
                "Perpendicular",
                ("Crossed : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            start_item = end_item;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/4*3;
            str = LOOKUP_YES_NO(arrival_circuit_entered);
            ScanaStudio.dec_item_new(decoder_items.channel_index, start_item, end_item);
            ScanaStudio.dec_item_add_content("Arrival Circle Entered : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                end_item,
                "Fast Packet Data",
                ("Arrival Circle Entered : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            switch (calculation_type)
            {
                case 0 :
                {
                    str = "Great Circle";
                    break;
                }
                case 1 :
                {
                    str = "Rhumb Line";
                    break;
                }
            }
            ScanaStudio.dec_item_new(decoder_items.channel_index, end_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Calculation Type : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                end_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("Calculation Type : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 7 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 8 :
        {
            multi_byte_value += (hex_value<<8);
            skip_item = true;
            break;
        }
        case 9 :
        {
            multi_byte_value += (hex_value<<16);
            skip_item = true;
            break;
        }
        case 10 :
        {
            multi_byte_value += hex_value*Math.pow(2,24);
            system_time.setTime((multi_byte_value/10)-(3600*1000)); // the Date object is initialize the 1 january, 1970 at 1am
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("ETA Time : " + system_time.getHours() + "h" + system_time.getMinutes() + "min" + system_time.getSeconds() + "sec");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("ETA Time : " + system_time.getHours() + "h" + system_time.getMinutes() + "min" + system_time.getSeconds() + "sec"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 11 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 12 :
        {
            multi_byte_value += (hex_value<<8);
            system_time.setTime((multi_byte_value)*1000*24*3600);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("ETA Date : " + system_time.getMonth() + "/" + system_time.getDate() + "/" + system_time.getFullYear() + " (month/day/year)");
            ScanaStudio.dec_item_add_content("ETA Date : " + system_time.getMonth() + "/" + system_time.getDate() + "/" + system_time.getFullYear());
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("ETA Date : " + system_time.getMonth() + "/" + system_time.getDate() + "/" + system_time.getFullYear() + " (m/d/y)"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 13 :
        {
            ScanaStudio.dec_item_new(decoder_items.channel_index, decoder_items.start_sample_index, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Bearing, Origin to Destination Waypoint (LSByte) : 0x" + pad(hex_value.toString(16),2));
            ScanaStudio.dec_item_add_content("0x" + pad(hex_value.toString(16),2));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                decoder_items.end_sample_index,
                "Bearing Origin",
                ("to Waypoint (LSByte) : 0x" + pad(hex_value.toString(16),2)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 14 :
        {
            ScanaStudio.dec_item_new(decoder_items.channel_index, decoder_items.start_sample_index, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Bearing, Origin to Destination Waypoint (MSByte) : 0x" + pad(hex_value.toString(16),2));
            ScanaStudio.dec_item_add_content("0x" + pad(hex_value.toString(16),2));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                decoder_items.end_sample_index,
                "Bearing Origin",
                ("to Waypoint (MSByte) : 0x" + pad(hex_value.toString(16),2)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 15 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 16 :
        {
            multi_byte_value += (hex_value<<8);
            multi_byte_value = multi_byte_value/10000;
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Bearing, Position to Destination Waypoint : " + multi_byte_value.toFixed(4) + "rad");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(4) + " rad")
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Bearing Position ",
                ("to Waypoint : " + multi_byte_value.toFixed(4) + "rad"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 17 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 18 :
        {
            multi_byte_value += (hex_value<<8);
            skip_item = true;
            break;
        }
        case 19 :
        {
            multi_byte_value += (hex_value<<16);
            skip_item = true;
            break;
        }
        case 20 :
        {
            multi_byte_value += hex_value*Math.pow(2,24);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Origin Waypoint Number : 0x" + pad(multi_byte_value.toString(16),8));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Origin",
                ("Waypoint Number : 0x" + pad(multi_byte_value.toString(16),8)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 21 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 22 :
        {
            multi_byte_value += (hex_value<<8);
            skip_item = true;
            break;
        }
        case 23 :
        {
            multi_byte_value += (hex_value<<16);
            skip_item = true;
            break;
        }
        case 24 :
        {
            multi_byte_value += hex_value*Math.pow(2,24);
            ScanaStudio.dec_item_new(decoder_items.channel_index, start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Destination Waypoint Number : 0x" + pad(multi_byte_value.toString(16),8));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                decoder_items.end_sample_index,
                "Destination",
                ("Waypoint Number : 0x" + pad(multi_byte_value.toString(16),8)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 25 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 26 :
        {
            multi_byte_value += (hex_value<<8);
            skip_item = true;
            break;
        }
        case 27 :
        {
            multi_byte_value += (hex_value<<16);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Destination Latitude (LSBytes) : 0x" + pad(multi_byte_value.toString(16),6));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Destination",
                ("Latitude (LSBytes) : 0x" + pad(multi_byte_value.toString(16),6)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 28 :
        {
            ScanaStudio.dec_item_new(decoder_items.channel_index,decoder_items.start_sample_index,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Destination Latitude (MSByte) : 0x" + pad(hex_value.toString(16),2));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                decoder_items.end_sample_index,
                "Destination",
                ("Latitude (MSByte) : 0x" + pad(hex_value.toString(16),2)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 29 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 30 :
        {
            multi_byte_value += (hex_value<<8);
            skip_item = true;
            break;
        }
        case 31 :
        {
            multi_byte_value += (hex_value<<16);
            skip_item = true;
            break;
        }
        case 32 :
        {
            multi_byte_value += hex_value*Math.pow(2,24);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Destination Longitude : 0x" + pad(multi_byte_value.toString(16),8));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Destination",
                ("Longitude : 0x" + pad(multi_byte_value.toString(16),8)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 33 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 34 :
        {
            multi_byte_value += (hex_value<<8);
            multi_byte_value = multi_byte_value*0.01;
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Waypoint Closing Velocity : " + multi_byte_value.toFixed(2) + " m/s");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(2) + " m/s");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Waypoint",
                ("Closing Velocity : " + multi_byte_value.toFixed(2) + " m/s"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        default :
        {
            packet_title = "Filled Data";
            if (hex_value == 255)
            {
                item_content = "Filled with 0xFF";
            }
            else
            {
                item_content = "0x" + pad(hex_value.toString(16),2) + ", should be 0xFF";
                types_title = ScanaStudio.PacketColors.Error.Title;
                types_content = ScanaStudio.PacketColors.Error.Content;
            }
        }
    }//end switch (byte)
}//end function Navigation_Data

function AIS_Class_A_Static_and_Voyage_Related_Data (decoder_items) //129794
{
    var str = "";
    switch (fast_packet_byte)
    {
        case 1 :
        {
            var message_id = hex_value>>2;
            var repeat_indicator = hex_value&0x3;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/4*3;
            ScanaStudio.dec_item_new(decoder_items.channel_index,decoder_items.start_sample_index, end_item);
            ScanaStudio.dec_item_add_content("Message ID : 0x" + pad(message_id.toString(16),2));
            ScanaStudio.dec_item_add_content("0x" + pad(message_id.toString(16),2));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                end_item,
                "Fast Packet Data",
                ("Message ID : 0x" + pad(message_id.toString(16),2)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            str = LOOKUP_REPEAT_INDICATOR(repeat_indicator);
            ScanaStudio.dec_item_new(decoder_items.channel_index, end_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Repeat Indicator : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                end_item,
                decoder_items.end_sample_index,
                "Repeat Indicator",
                (str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 2 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value
            skip_item = true;
            break;
        }
        case 3 :
        {
            multi_byte_value += (hex_value<<8);
            skip_item = true;
            break;
        }
        case 4 :
        {
            multi_byte_value += (hex_value<<16);
            skip_item = true;
            break;
        }
        case 5 :
        {
            multi_byte_value += hex_value*Math.pow(2,24);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("User ID : 0x" + pad(multi_byte_value.toString(16),8));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("User ID : 0x" + pad(multi_byte_value.toString(16),8)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 6 :
        {
            item_content = "IMO number (LSByte) : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 7 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 8 :
        {
            multi_byte_value += (hex_value<<8);
            skip_item = true;
            break;
        }
        case 9 :
        {
            multi_byte_value += (hex_value<<16);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("IMO number (MSBytes) : 0x" + pad(multi_byte_value.toString(16),6));
            ScanaStudio.dec_item_add_content("0x" + pad(multi_byte_value.toString(16),6));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("IMO number (MSBytes) : 0x" + pad(multi_byte_value.toString(16),6)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 10 :
        case 11 :
        case 12 :
        case 13 :
        case 14 :
        case 15 :
        case 16 :
        {
            item_content = "Callsign : " + "'" + String.fromCharCode(hex_value) + "'";
            break;
        }
        case 17 :
        case 18 :
        case 19 :
        case 20 :
        case 21 :
        case 22 :
        case 23 :
        case 24 :
        case 25 :
        case 26 :
        case 27 :
        case 28 :
        case 29 :
        case 30 :
        case 31 :
        case 32 :
        case 33 :
        case 34 :
        case 35 :
        case 36 :
        {
            item_content = "Name : " + "'" + String.fromCharCode(hex_value) + "'";
            break;
        }
        case 37 :
        {
            str = LOOKUP_SHIP_TYPE(hex_value);
            item_content = "Type of ship : " + str;
            break;
        }
        case 38 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 39 :
        {
            multi_byte_value += (hex_value<<8);
            multi_byte_value = multi_byte_value*0.1;
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Length : " + multi_byte_value.toFixed(1) + " m");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(1) + " m");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("Length : " + multi_byte_value.toFixed(1) + " m"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 40 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 41 :
        {
            multi_byte_value += (hex_value<<8);
            multi_byte_value = multi_byte_value*0.1;
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Beam : " + multi_byte_value.toFixed(1) + " m");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(1) + " m");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("Beam : " + multi_byte_value.toFixed(1) + " m"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 42 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 43 :
        {
            multi_byte_value += (hex_value<<8);
            multi_byte_value = multi_byte_value*0.1;
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Position reference from Starboard : " + multi_byte_value.toFixed(1) + " m");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(1) + " m");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Position reference",
                (" from Starboard : " + multi_byte_value.toFixed(1) + " m"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 44 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 45 :
        {
            multi_byte_value += (hex_value<<8);
            multi_byte_value = multi_byte_value*0.1;
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Position reference from Bow : " + multi_byte_value.toFixed(1) + " m");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(1) + " m");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Position reference",
                (" from Bow : " + multi_byte_value.toFixed(1) + " m"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 46 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 47 :
        {
            multi_byte_value += (hex_value<<8);
            system_time.setTime((multi_byte_value)*1000*24*3600);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("ETA Date : " + system_time.getMonth() + "/" + system_time.getDate() + "/" + system_time.getFullYear() + " (month/day/year)");
            ScanaStudio.dec_item_add_content("ETA Date : " + system_time.getMonth() + "/" + system_time.getDate() + "/" + system_time.getFullYear());
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("ETA Date : " + system_time.getMonth() + "/" + system_time.getDate() + "/" + system_time.getFullYear() + " (m/d/y)"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 48 :
        {
            item_content = "ETA Time (LSByte) : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 49 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 50 :
        {
            multi_byte_value += (hex_value<<8);
            skip_item = true;
            break;
        }
        case 51 :
        {
            multi_byte_value += (hex_value<<16);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("ETA Time (MSBytes) : 0x" + pad(multi_byte_value.toString(16),6));
            ScanaStudio.dec_item_add_content("0x" + pad(multi_byte_value.toString(16),6));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("ETA Time (MSBytes) : 0x" + pad(multi_byte_value.toString(16),6)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 52 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 53 :
        {
            multi_byte_value += (hex_value<<8);
            multi_byte_value = multi_byte_value*0.01;
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Draft : " + multi_byte_value.toFixed(2) + " m");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(2) + " m");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("Draft : " + multi_byte_value.toFixed(2) + " m"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 54 :
        case 55 :
        case 56 :
        case 57 :
        case 58 :
        case 59 :
        case 60 :
        case 61 :
        case 62 :
        case 63 :
        case 64 :
        case 65 :
        case 66 :
        case 67 :
        case 68 :
        case 69 :
        case 70 :
        case 71 :
        case 72 :
        case 73 :
        {
            item_content = "Destination : " + "'" + String.fromCharCode(hex_value) + "'";
            break;
        }
        case 74 :
        {
            var ais_version_indicator = hex_value>>6;
            var gnss_type = (hex_value>>2)&0x3;
            var dte = (hex_value>>1)&0x1;
            var reserved = hex_value&0x1;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/4;
            switch (ais_version_indicator)
            {
                case 0 :
                {
                    str = "ITU-R M.1371-1";
                    break;
                }
                case 1 :
                {
                    str = "ITU-R M.1371-3";
                    break;
                }
                default :
                {
                    str = "Reserved";
                    break;
                }
            }
            ScanaStudio.dec_item_new(decoder_items.channel_index,decoder_items.start_sample_index, end_item);
            ScanaStudio.dec_item_add_content("AIS version indicator : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                end_item,
                "AIS Version",
                ("Indicator : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            start_item = end_item;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/4*3;
            str = LOOKUP_GNS_AIS(gnss_type);
            ScanaStudio.dec_item_new(decoder_items.channel_index, start_item, end_item);
            ScanaStudio.dec_item_add_content("GNSS type : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                end_item,
                "Fast Packet Data",
                ("GNSS type : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            start_item = end_item;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/8*7;
            switch (dte)
            {
                case 0 :
                {
                    str = "available";
                    break;
                }
                case 1 :
                {
                    str = "not available";
                    break;
                }
                default :
                {
                    str = "Reserved";
                    break;
                }
            }
            ScanaStudio.dec_item_new(decoder_items.channel_index, start_item, end_item);
            ScanaStudio.dec_item_add_content("DTE : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                end_item,
                "Fast Packet Data",
                ("DTE : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            ScanaStudio.dec_item_new(decoder_items.channel_index, end_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Reserved : 0x" + pad(reserved.toString(16),1));
            ScanaStudio.dec_item_add_content("Reserved");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                end_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("Reserved : 0x" + pad(reserved.toString(16),1)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 75 :
        {
            var ais_transceiver_information = hex_value>>3;
            var reserved = hex_value&0x1F;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/8*5;
            str = LOOKUP_AIS_TRANSCEIVER(ais_transceiver_information);
            ScanaStudio.dec_item_new(decoder_items.channel_index,decoder_items.start_sample_index, end_item);
            ScanaStudio.dec_item_add_content("AIS Transceiver information : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                end_item,
                "AIS Transceiver",
                ("Info : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            ScanaStudio.dec_item_new(decoder_items.channel_index, end_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Reserved : 0x" + pad(reserved.toString(16),1));
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                end_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("Reserved : 0x" + pad(reserved.toString(16),1)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        default :
        {
            packet_title = "Filled Data";
            if (hex_value == 255)
            {
                item_content = "Filled with 0xFF";
            }
            else
            {
                item_content = "0x" + pad(hex_value.toString(16),2) + ", should be 0xFF";
                types_title = ScanaStudio.PacketColors.Error.Title;
                types_content = ScanaStudio.PacketColors.Error.Content;
            }
        }
    }//end switch (byte)
}//end function AIS_Class_A_Static_and_Voyage_Related_Data

function AIS_Addressed_Binary_Message (decoder_items) //129795
{
    var str = "";
    switch (fast_packet_byte)
    {
        case 1 :
        {
            var message_id = hex_value>>2;
            var repeat_indicator = hex_value&0x3;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/4*3;
            ScanaStudio.dec_item_new(decoder_items.channel_index,decoder_items.start_sample_index, end_item);
            ScanaStudio.dec_item_add_content("Message ID : 0x" + pad(message_id.toString(16),2));
            ScanaStudio.dec_item_add_content("0x" + pad(message_id.toString(16),2));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                end_item,
                "Fast Packet Data",
                ("Message ID : 0x" + pad(message_id.toString(16),2)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            str = LOOKUP_REPEAT_INDICATOR(repeat_indicator);
            ScanaStudio.dec_item_new(decoder_items.channel_index, end_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Repeat Indicator : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                end_item,
                decoder_items.end_sample_index,
                "Repeat Indicator",
                (str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 2 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value
            skip_item = true;
            break;
        }
        case 3 :
        {
            multi_byte_value += (hex_value<<8);
            skip_item = true;
            break;
        }
        case 4 :
        {
            multi_byte_value += (hex_value<<16);
            skip_item = true;
            break;
        }
        case 5 :
        {
            multi_byte_value += hex_value*Math.pow(2,24);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Source ID : 0x" + pad(multi_byte_value.toString(16),8));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("User ID : 0x" + pad(multi_byte_value.toString(16),8)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 6 :
        {
            var reserved = hex_value>>7;
            var ais_transceiver_information = (hex_value>>2)&0x1F;
            var sequence_number = hex_value&0x3;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/8;
            ScanaStudio.dec_item_new(decoder_items.channel_index,decoder_items.start_sample_index, end_item);
            ScanaStudio.dec_item_add_content("Reserved : 0x" + pad(reserved.toString(16),1));
            ScanaStudio.dec_item_add_content("Reserved");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                end_item,
                "Fast Packet Data",
                ("Reserved : 0x" + pad(reserved.toString(16),1)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            start_item = end_item;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/4*3;
            str = LOOKUP_AIS_TRANSCEIVER(ais_transceiver_information);
            ScanaStudio.dec_item_new(decoder_items.channel_index, start_item, end_item);
            ScanaStudio.dec_item_add_content("AIS Transceiver information : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                end_item,
                "AIS Transceiver",
                ("Info : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            ScanaStudio.dec_item_new(decoder_items.channel_index, end_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Sequence Number : 0x" + pad(sequence_number.toString(16),1));
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                end_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("Sequence Number : 0x" + pad(sequence_number.toString(16),1)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 7 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 8 :
        {
            multi_byte_value += (hex_value<<8);
            skip_item = true;
            break;
        }
        case 9 :
        {
            multi_byte_value += (hex_value<<16);
            skip_item = true;
            break;
        }
        case 10 :
        {
            multi_byte_value += hex_value*Math.pow(2,24);
            ScanaStudio.dec_item_new(decoder_items.channel_index, start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Destination ID : 0x" + pad(multi_byte_value.toString(16),8));
            ScanaStudio.dec_item_add_content("0x" + pad(multi_byte_value.toString(16),8));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("Destination ID : 0x" + pad(multi_byte_value.toString(16),8)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 11 :
        {
            var reserved = hex_value>>2;
            var retransmit_flag = (hex_value>>1)&0x1;
            var reserved_2 = hex_value&0x1;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/4*3;
            ScanaStudio.dec_item_new(decoder_items.channel_index,decoder_items.start_sample_index, end_item);
            ScanaStudio.dec_item_add_content("Reserved : 0x" + pad(reserved.toString(16),2));
            ScanaStudio.dec_item_add_content("Reserved");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                end_item,
                "Fast Packet Data",
                ("Reserved : 0x" + pad(reserved.toString(16),2)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            start_item = end_item;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/8*7;
            ScanaStudio.dec_item_new(decoder_items.channel_index, start_item, end_item);
            ScanaStudio.dec_item_add_content("Retransmit flag : 0x" + pad(retransmit_flag.toString(16),1));
            ScanaStudio.dec_item_add_content("0x" + pad(retransmit_flag.toString(16),1));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                end_item,
                "Fast Packet Data",
                ("Retransmit flag : 0x" + pad(retransmit_flag.toString(16),1)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            ScanaStudio.dec_item_new(decoder_items.channel_index, end_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Reserved : 0x" + pad(reserved.toString(16),1));
            ScanaStudio.dec_item_add_content("Reserved");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                end_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("Reserved : 0x" + pad(reserved.toString(16),1)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 12 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 13 :
        {
            multi_byte_value += (hex_value<<8);
            ScanaStudio.dec_item_new(decoder_items.channel_index, start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Number of Bits in Binary Data Field : 0x" + pad(multi_byte_value.toString(16),4));
            ScanaStudio.dec_item_add_content("Reserved");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Number of Bits",
                ("in Binary Data Field : 0x" + pad(multi_byte_value.toString(16),4)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 14 :
        case 15 :
        case 16 :
        case 17 :
        case 18 :
        case 19 :
        case 20 :
        case 21 :
        {
            item_content = "Binary Data : 0x" + pad(hex_value.toString(16),1);
            break;
        }
        default :
        {
            packet_title = "Filled Data";
            if (hex_value == 255)
            {
                item_content = "Filled with 0xFF";
            }
            else
            {
                item_content = "0x" + pad(hex_value.toString(16),2) + ", should be 0xFF";
                types_title = ScanaStudio.PacketColors.Error.Title;
                types_content = ScanaStudio.PacketColors.Error.Content;
            }
        }
    }//end switch (byte)
}//end function AIS_Addressed_Binary_Message

function AIS_Acknowledge (decoder_items) //129796
{
    var str = "";
    switch (fast_packet_byte)
    {
        case 1 :
        {
            var message_id = hex_value>>2;
            var repeat_indicator = hex_value&0x3;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/4*3;
            ScanaStudio.dec_item_new(decoder_items.channel_index,decoder_items.start_sample_index, end_item);
            ScanaStudio.dec_item_add_content("Message ID : 0x" + pad(message_id.toString(16),2));
            ScanaStudio.dec_item_add_content("0x" + pad(message_id.toString(16),2));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                end_item,
                "Fast Packet Data",
                ("Message ID : 0x" + pad(message_id.toString(16),2)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            str = LOOKUP_REPEAT_INDICATOR(repeat_indicator);
            ScanaStudio.dec_item_new(decoder_items.channel_index, end_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Repeat Indicator : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                end_item,
                decoder_items.end_sample_index,
                "Repeat Indicator",
                (str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 2 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value
            skip_item = true;
            break;
        }
        case 3 :
        {
            multi_byte_value += (hex_value<<8);
            skip_item = true;
            break;
        }
        case 4 :
        {
            multi_byte_value += (hex_value<<16);
            skip_item = true;
            break;
        }
        case 5 :
        {
            multi_byte_value += hex_value*Math.pow(2,24);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Source ID : 0x" + pad(multi_byte_value.toString(16),8));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("Source ID : 0x" + pad(multi_byte_value.toString(16),8)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 6 :
        {
            var reserved = hex_value>>7;
            var ais_transceiver_information = (hex_value>>2)&0x1F;
            var sequence_number = hex_value&0x3;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/8;
            ScanaStudio.dec_item_new(decoder_items.channel_index,decoder_items.start_sample_index, end_item);
            ScanaStudio.dec_item_add_content("Reserved : 0x" + pad(reserved.toString(16),1));
            ScanaStudio.dec_item_add_content("Reserved");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                end_item,
                "Fast Packet Data",
                ("Reserved : 0x" + pad(reserved.toString(16),1)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            start_item = end_item;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/4*3;
            str = LOOKUP_AIS_TRANSCEIVER(ais_transceiver_information);
            ScanaStudio.dec_item_new(decoder_items.channel_index, start_item, end_item);
            ScanaStudio.dec_item_add_content("AIS Transceiver information : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                end_item,
                "AIS Transceiver",
                ("Info : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            ScanaStudio.dec_item_new(decoder_items.channel_index, end_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Sequence Number : 0x" + pad(sequence_number.toString(16),1));
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                end_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("Sequence Number : 0x" + pad(sequence_number.toString(16),1)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 7 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 8 :
        {
            multi_byte_value += (hex_value<<8);
            skip_item = true;
            break;
        }
        case 9 :
        {
            multi_byte_value += (hex_value<<16);
            skip_item = true;
            break;
        }
        case 10 :
        {
            multi_byte_value += hex_value*Math.pow(2,24);
            ScanaStudio.dec_item_new(decoder_items.channel_index, start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Destination ID #1 : 0x" + pad(multi_byte_value.toString(16),8));
            ScanaStudio.dec_item_add_content("0x" + pad(multi_byte_value.toString(16),8));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("Destination ID #1 : 0x" + pad(multi_byte_value.toString(16),8)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 11 :
        {
            var sequence_number = hex_value>>6;
            var reserved = hex_value&0x3F;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/4;
            ScanaStudio.dec_item_new(decoder_items.channel_index,decoder_items.start_sample_index, end_item);
            ScanaStudio.dec_item_add_content("Sequence Number for ID 1 : 0x" + pad(sequence_number.toString(16),1));
            ScanaStudio.dec_item_add_content("0x" + pad(sequence_number.toString(16),1));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                end_item,
                "Fast Packet Data",
                ("Sequence Number for ID 1 : 0x" + pad(sequence_number.toString(16),1)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            ScanaStudio.dec_item_new(decoder_items.channel_index, end_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Reserved : 0x" + pad(reserved.toString(16),2));
            ScanaStudio.dec_item_add_content("Reserved");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                end_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("Reserved : 0x" + pad(reserved.toString(16),2)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 12 :
        {
            var sequence_number = hex_value>>6;
            var reserved = hex_value&0x3F;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/4;
            ScanaStudio.dec_item_new(decoder_items.channel_index,decoder_items.start_sample_index, end_item);
            ScanaStudio.dec_item_add_content("Sequence Number for ID 2 : 0x" + pad(sequence_number.toString(16),1));
            ScanaStudio.dec_item_add_content("0x" + pad(sequence_number.toString(16),1));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                end_item,
                "Fast Packet Data",
                ("Sequence Number for ID 2 : 0x" + pad(sequence_number.toString(16),1)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            ScanaStudio.dec_item_new(decoder_items.channel_index, end_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Reserved : 0x" + pad(reserved.toString(16),2));
            ScanaStudio.dec_item_add_content("Reserved");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                end_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("Reserved : 0x" + pad(reserved.toString(16),2)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        default :
        {
            packet_title = "Filled Data";
            if (hex_value == 255)
            {
                item_content = "Filled with 0xFF";
            }
            else
            {
                item_content = "0x" + pad(hex_value.toString(16),2) + ", should be 0xFF";
                types_title = ScanaStudio.PacketColors.Error.Title;
                types_content = ScanaStudio.PacketColors.Error.Content;
            }
        }
    }//end switch (byte)
}//end function AIS_Acknowledge

function AIS_Binary_Broadcast_Message (decoder_items) //129797
{
    var str = "";
    if (fast_packet_byte == 1)
    {
        var message_id = hex_value>>2;
        var repeat_indicator = hex_value&0x3;
        end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/4*3;
        ScanaStudio.dec_item_new(decoder_items.channel_index,decoder_items.start_sample_index, end_item);
        ScanaStudio.dec_item_add_content("Message ID : 0x" + pad(message_id.toString(16),2));
        ScanaStudio.dec_item_add_content("0x" + pad(message_id.toString(16),2));
        ScanaStudio.dec_item_end();
        // Packet View
        ScanaStudio.packet_view_add_packet(false,
            decoder_items.channel_index,
            decoder_items.start_sample_index,
            end_item,
            "Fast Packet Data",
            ("Message ID : 0x" + pad(message_id.toString(16),2)),
            ScanaStudio.PacketColors.Data.Title,
            ScanaStudio.PacketColors.Data.Content);
        str = LOOKUP_REPEAT_INDICATOR(repeat_indicator);
        ScanaStudio.dec_item_new(decoder_items.channel_index, end_item, decoder_items.end_sample_index);
        ScanaStudio.dec_item_add_content("Repeat Indicator : " + str);
        ScanaStudio.dec_item_add_content(str);
        ScanaStudio.dec_item_end();
        // Packet View
        ScanaStudio.packet_view_add_packet(false,
            decoder_items.channel_index,
            end_item,
            decoder_items.end_sample_index,
            "Repeat Indicator",
            (str),
            ScanaStudio.PacketColors.Data.Title,
            ScanaStudio.PacketColors.Data.Content);
        skip_item = true;
    }
    else if (fast_packet_byte == 2)
    {
        start_item = decoder_items.start_sample_index;
        multi_byte_value = hex_value
        skip_item = true;
    }
    else if (fast_packet_byte == 3)
    {
        multi_byte_value += (hex_value<<8);
        skip_item = true;
    }
    else if (fast_packet_byte == 4)
    {
        multi_byte_value += (hex_value<<16);
        skip_item = true;
    }
    else if (fast_packet_byte == 5)
    {
        multi_byte_value += hex_value*Math.pow(2,24);
        ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
        ScanaStudio.dec_item_add_content("Source ID : 0x" + pad(multi_byte_value.toString(16),8));
        ScanaStudio.dec_item_end();
        // Packet View
        ScanaStudio.packet_view_add_packet(false,
            decoder_items.channel_index,
            start_item,
            decoder_items.end_sample_index,
            "Fast Packet Data",
            ("Source ID : 0x" + pad(multi_byte_value.toString(16),8)),
            ScanaStudio.PacketColors.Data.Title,
            ScanaStudio.PacketColors.Data.Content);
        skip_item = true;
    }
    else if (fast_packet_byte == 6)
    {
        var reserved = hex_value>>7;
        var ais_transceiver_information = (hex_value>>2)&0x1F;
        var sequence_number = hex_value&0x3;
        end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/8;
        ScanaStudio.dec_item_new(decoder_items.channel_index,decoder_items.start_sample_index, end_item);
        ScanaStudio.dec_item_add_content("Reserved : 0x" + pad(reserved.toString(16),1));
        ScanaStudio.dec_item_add_content("Reserved");
        ScanaStudio.dec_item_end();
        // Packet View
        ScanaStudio.packet_view_add_packet(false,
            decoder_items.channel_index,
            decoder_items.start_sample_index,
            end_item,
            "Fast Packet Data",
            ("Reserved : 0x" + pad(reserved.toString(16),1)),
            ScanaStudio.PacketColors.Data.Title,
            ScanaStudio.PacketColors.Data.Content);
        start_item = end_item;
        end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/4*3;
        str = LOOKUP_AIS_TRANSCEIVER(ais_transceiver_information);
        ScanaStudio.dec_item_new(decoder_items.channel_index, start_item, end_item);
        ScanaStudio.dec_item_add_content("AIS Transceiver information : " + str);
        ScanaStudio.dec_item_add_content(str);
        ScanaStudio.dec_item_end();
        // Packet View
        ScanaStudio.packet_view_add_packet(false,
            decoder_items.channel_index,
            start_item,
            end_item,
            "AIS Transceiver",
            ("Info : " + str),
            ScanaStudio.PacketColors.Data.Title,
            ScanaStudio.PacketColors.Data.Content);
        ScanaStudio.dec_item_new(decoder_items.channel_index, end_item, decoder_items.end_sample_index);
        ScanaStudio.dec_item_add_content("Sequence Number : 0x" + pad(sequence_number.toString(16),1));
        ScanaStudio.dec_item_add_content(str);
        ScanaStudio.dec_item_end();
        // Packet View
        ScanaStudio.packet_view_add_packet(false,
            decoder_items.channel_index,
            end_item,
            decoder_items.end_sample_index,
            "Fast Packet Data",
            ("Sequence Number : 0x" + pad(sequence_number.toString(16),1)),
            ScanaStudio.PacketColors.Data.Title,
            ScanaStudio.PacketColors.Data.Content);
        skip_item = true;
    }
    else if (fast_packet_byte == 7)
    {
        start_item = decoder_items.start_sample_index;
        multi_byte_value = hex_value;
        skip_item = true;
    }
    else if (fast_packet_byte == 8)
    {
        multi_byte_value += (hex_value<<8);
        ScanaStudio.dec_item_new(decoder_items.channel_index, start_item, decoder_items.end_sample_index);
        ScanaStudio.dec_item_add_content("Number of Bits in Binary Data Field : 0x" + pad(multi_byte_value.toString(16),4));
        ScanaStudio.dec_item_add_content("Reserved");
        ScanaStudio.dec_item_end();
        // Packet View
        ScanaStudio.packet_view_add_packet(false,
            decoder_items.channel_index,
            start_item,
            decoder_items.end_sample_index,
            "Number of Bits",
            ("in Binary Data Field : 0x" + pad(multi_byte_value.toString(16),4)),
            ScanaStudio.PacketColors.Data.Title,
            ScanaStudio.PacketColors.Data.Content);
        skip_item = true;
    }
    else if ((fast_packet_byte > 8) && (fast_packet_byte < 264))
    {
        item_content = "Binary Data : 0x" + pad(hex_value.toString(16),2);
    }
    else
    {
        packet_title = "Filled Data";
        if (hex_value == 255)
        {
            item_content = "Filled with 0xFF";
        }
        else
        {
            item_content = "0x" + pad(hex_value.toString(16),2) + ", should be 0xFF";
            types_title = ScanaStudio.PacketColors.Error.Title;
            types_content = ScanaStudio.PacketColors.Error.Content;
        }
    }
}//end function AIS_Binary_Broadcast_Message

function AIS_Class_B_static_data_part_A (decoder_items) //129809
{
    var str = "";
    if (fast_packet_byte == 1)
    {
        var message_id = hex_value>>2;
        var repeat_indicator = hex_value&0x3;
        end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/4*3;
        ScanaStudio.dec_item_new(decoder_items.channel_index,decoder_items.start_sample_index, end_item);
        ScanaStudio.dec_item_add_content("Message ID : 0x" + pad(message_id.toString(16),2));
        ScanaStudio.dec_item_add_content("0x" + pad(message_id.toString(16),2));
        ScanaStudio.dec_item_end();
        // Packet View
        ScanaStudio.packet_view_add_packet(false,
            decoder_items.channel_index,
            decoder_items.start_sample_index,
            end_item,
            "Fast Packet Data",
            ("Message ID : 0x" + pad(message_id.toString(16),2)),
            ScanaStudio.PacketColors.Data.Title,
            ScanaStudio.PacketColors.Data.Content);
        str = LOOKUP_REPEAT_INDICATOR(repeat_indicator);
        ScanaStudio.dec_item_new(decoder_items.channel_index, end_item, decoder_items.end_sample_index);
        ScanaStudio.dec_item_add_content("Repeat Indicator : " + str);
        ScanaStudio.dec_item_add_content(str);
        ScanaStudio.dec_item_end();
        // Packet View
        ScanaStudio.packet_view_add_packet(false,
            decoder_items.channel_index,
            end_item,
            decoder_items.end_sample_index,
            "Repeat Indicator",
            (str),
            ScanaStudio.PacketColors.Data.Title,
            ScanaStudio.PacketColors.Data.Content);
        skip_item = true;
    }
    else if (fast_packet_byte == 2)
    {
        start_item = decoder_items.start_sample_index;
        multi_byte_value = hex_value
        skip_item = true;
    }
    else if (fast_packet_byte == 3)
    {
        multi_byte_value += (hex_value<<8);
        skip_item = true;
    }
    else if (fast_packet_byte == 4)
    {
        multi_byte_value += (hex_value<<16);
        skip_item = true;
    }
    else if (fast_packet_byte == 5)
    {
        multi_byte_value += hex_value*Math.pow(2,24);
        ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
        ScanaStudio.dec_item_add_content("User ID : 0x" + pad(multi_byte_value.toString(16),8));
        ScanaStudio.dec_item_end();
        // Packet View
        ScanaStudio.packet_view_add_packet(false,
            decoder_items.channel_index,
            start_item,
            decoder_items.end_sample_index,
            "Fast Packet Data",
            ("User ID : 0x" + pad(multi_byte_value.toString(16),8)),
            ScanaStudio.PacketColors.Data.Title,
            ScanaStudio.PacketColors.Data.Content);
        skip_item = true;
    }
    else if (fast_packet_byte > 5 && fast_packet_byte < 26)
    {
        item_content = "Name : 0x" + pad(hex_value.toString(16),2);
    }
    else if (fast_packet_byte == 26)
    {
        var ais_transceiver_information = (hex_value>>3);
        var reserved = hex_value&0x7;
        end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/8*5;
        str = LOOKUP_AIS_TRANSCEIVER(ais_transceiver_information);
        ScanaStudio.dec_item_new(decoder_items.channel_index, decoder_items.start_sample_index, end_item);
        ScanaStudio.dec_item_add_content("AIS Transceiver information : " + str);
        ScanaStudio.dec_item_add_content(str);
        ScanaStudio.dec_item_end();
        // Packet View
        ScanaStudio.packet_view_add_packet(false,
            decoder_items.channel_index,
            decoder_items.start_sample_index,
            end_item,
            "AIS Transceiver",
            ("Info : " + str),
            ScanaStudio.PacketColors.Data.Title,
            ScanaStudio.PacketColors.Data.Content);
        ScanaStudio.dec_item_new(decoder_items.channel_index, end_item, decoder_items.end_sample_index);
        ScanaStudio.dec_item_add_content("Reserved : 0x" + pad(reserved.toString(16),1));
        ScanaStudio.dec_item_add_content("Reserved");
        ScanaStudio.dec_item_end();
        // Packet View
        ScanaStudio.packet_view_add_packet(false,
            decoder_items.channel_index,
            end_item,
            decoder_items.end_sample_index,
            "Fast Packet Data",
            ("Reserved : 0x" + pad(reserved.toString(16),1)),
            ScanaStudio.PacketColors.Data.Title,
            ScanaStudio.PacketColors.Data.Content);
        skip_item = true;
    }
    else if (fast_packet_byte == 27)
    {
        item_content = "Sequence ID : 0x" + pad(hex_value.toString(16),2);
    }
    else
    {
        packet_title = "Filled Data";
        if (hex_value == 255)
        {
            item_content = "Filled with 0xFF";
        }
        else
        {
            item_content = "0x" + pad(hex_value.toString(16),2) + ", should be 0xFF";
            types_title = ScanaStudio.PacketColors.Error.Title;
            types_content = ScanaStudio.PacketColors.Error.Content;
        }
    }
}//end function AIS_Class_B_static_data_part_A

function AIS_Class_B_static_data_part_B (decoder_items) //129810
{
    var str = "";
    switch (fast_packet_byte)
    {
        case 1 :
        {
            var message_id = hex_value>>2;
            var repeat_indicator = hex_value&0x3;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/4*3;
            ScanaStudio.dec_item_new(decoder_items.channel_index,decoder_items.start_sample_index, end_item);
            ScanaStudio.dec_item_add_content("Message ID : 0x" + pad(message_id.toString(16),2));
            ScanaStudio.dec_item_add_content("0x" + pad(message_id.toString(16),2));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                end_item,
                "Fast Packet Data",
                ("Message ID : 0x" + pad(message_id.toString(16),2)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            str = LOOKUP_REPEAT_INDICATOR(repeat_indicator);
            ScanaStudio.dec_item_new(decoder_items.channel_index, end_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Repeat Indicator : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                end_item,
                decoder_items.end_sample_index,
                "Repeat Indicator",
                (str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 2 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value
            skip_item = true;
            break;
        }
        case 3 :
        {
            multi_byte_value += (hex_value<<8);
            skip_item = true;
            break;
        }
        case 4 :
        {
            multi_byte_value += (hex_value<<16);
            skip_item = true;
            break;
        }
        case 5 :
        {
            multi_byte_value += hex_value*Math.pow(2,24);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("User ID : 0x" + pad(multi_byte_value.toString(16),8));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("User ID : 0x" + pad(multi_byte_value.toString(16),8)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 6 :
        {
            str = LOOKUP_SHIP_TYPE(hex_value);
            item_content = "Type of ship : " + str;
            break;
        }
        case 7 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_string = String.fromCharCode(hex_value);
            skip_item = true;
            break;
        }
        case 8 :
        {
            multi_byte_string = multi_byte_string + String.fromCharCode(hex_value);
            skip_item = true;
            break;
        }
        case 9 :
        {
            multi_byte_string = multi_byte_string + String.fromCharCode(hex_value);
            skip_item = true;
            break;
        }
        case 10 :
        {
            multi_byte_string = multi_byte_string + String.fromCharCode(hex_value);
            skip_item = true;
            break;
        }
        case 11 :
        {
            multi_byte_string = multi_byte_string + String.fromCharCode(hex_value);
            skip_item = true;
            break;
        }
        case 12 :
        {
            multi_byte_string = multi_byte_string + String.fromCharCode(hex_value);
            skip_item = true;
            break;
        }
        case 13 :
        {
            multi_byte_string = multi_byte_string + String.fromCharCode(hex_value);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Vendor ID : " + "'" + multi_byte_string + "'");
            ScanaStudio.dec_item_add_content("'" + multi_byte_string + "'");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("Vendor ID : " + "'" + multi_byte_string + "'"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 14 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_string = String.fromCharCode(hex_value);
            skip_item = true;
            break;
        }
        case 15 :
        {
            multi_byte_string = multi_byte_string + String.fromCharCode(hex_value);
            skip_item = true;
            break;
        }
        case 16 :
        {
            multi_byte_string = multi_byte_string + String.fromCharCode(hex_value);
            skip_item = true;
            break;
        }
        case 17 :
        {
            multi_byte_string = multi_byte_string + String.fromCharCode(hex_value);
            skip_item = true;
            break;
        }
        case 18 :
        {
            multi_byte_string = multi_byte_string + String.fromCharCode(hex_value);
            skip_item = true;
            break;
        }
        case 19 :
        {
            multi_byte_string = multi_byte_string + String.fromCharCode(hex_value);
            skip_item = true;
            break;
        }
        case 20 :
        {
            multi_byte_string = multi_byte_string + String.fromCharCode(hex_value);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Callsign : " + "'" + multi_byte_string + "'");
            ScanaStudio.dec_item_add_content("'" + multi_byte_string + "'");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("Callsign : " + "'" + multi_byte_string + "'"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 21 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 22 :
        {
            multi_byte_value += (hex_value<<8);
            multi_byte_value = multi_byte_value*0.1;
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Length : " + multi_byte_value.toFixed(1) + " m");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(1) + " m");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("Length : " + multi_byte_value.toFixed(1) + " m"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 23 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 24 :
        {
            multi_byte_value += (hex_value<<8);
            multi_byte_value = multi_byte_value*0.1;
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Beam : " + multi_byte_value.toFixed(1) + " m");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(1) + " m");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("Beam : " + multi_byte_value.toFixed(1) + " m"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 25 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 26 :
        {
            multi_byte_value += (hex_value<<8);
            multi_byte_value = multi_byte_value*0.1;
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Position reference from Starboard : " + multi_byte_value.toFixed(1) + " m");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(1) + " m");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Position reference",
                (" from Starboard : " + multi_byte_value.toFixed(1) + " m"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 27 :
        {
            ScanaStudio.dec_item_new(decoder_items.channel_index,decoder_items.start_sample_index, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Position reference from Bow (LSByte) : 0x" + pad(hex_value.toString(16),2));
            ScanaStudio.dec_item_add_content("0x" + pad(hex_value.toString(16),2));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                decoder_items.end_sample_index,
                "Position reference",
                (" from Bow (LSByte) : 0x" + pad(hex_value.toString(16),2)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 28 :
        {
            ScanaStudio.dec_item_new(decoder_items.channel_index,decoder_items.start_sample_index, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Position reference from Bow (MSByte) : 0x" + pad(hex_value.toString(16),2));
            ScanaStudio.dec_item_add_content("0x" + pad(hex_value.toString(16),2));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                decoder_items.end_sample_index,
                "Position reference",
                (" from Bow (MSByte) : 0x" + pad(hex_value.toString(16),2)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 29 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 30 :
        {
            multi_byte_value += (hex_value<<8);
            skip_item = true;
            break;
        }
        case 31 :
        {
            multi_byte_value += (hex_value<<16);
            skip_item = true;
            break;
        }
        case 32 :
        {
            multi_byte_value += hex_value*Math.pow(2,24);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Mothership User ID : 0x" + pad(multi_byte_value.toString(16),8));
            ScanaStudio.dec_item_add_content("0x" + pad(multi_byte_value.toString(16),8));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("Mothership User ID : 0x" + pad(multi_byte_value.toString(16),8)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 33 :
        {
            var reserved = hex_value>>6;
            var spare = hex_value&0x3F;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/4;
            ScanaStudio.dec_item_new(decoder_items.channel_index, decoder_items.start_sample_index, end_item);
            ScanaStudio.dec_item_add_content("Reserved : 0x" + pad(reserved.toString(16),1));
            ScanaStudio.dec_item_add_content("Reserved");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                end_item,
                "Fast Packet Data",
                ("Reserved : 0x" + pad(reserved.toString(16),8)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            ScanaStudio.dec_item_new(decoder_items.channel_index, end_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Spare : 0x" + pad(spare.toString(16),2));
            ScanaStudio.dec_item_add_content("0x" + pad(spare.toString(16),2));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                end_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("Spare : 0x" + pad(spare.toString(16),2)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 34 :
        {
            var ais_transceiver_information = hex_value>>3;
            var reserved = hex_value&0x7;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/4;
            str = LOOKUP_AIS_TRANSCEIVER(ais_transceiver_information);
            ScanaStudio.dec_item_new(decoder_items.channel_index, decoder_items.start_sample_index, end_item);
            ScanaStudio.dec_item_add_content("AIS Transceiver information : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                end_item,
                "AIS Transceiver",
                ("Info : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            ScanaStudio.dec_item_new(decoder_items.channel_index, end_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Reserved : 0x" + pad(reserved.toString(16),1));
            ScanaStudio.dec_item_add_content("Reserved" + pad(reserved.toString(16),1));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                end_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("Reserved : 0x" + pad(reserved.toString(16),1)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 35 :
        {
            item_content = "Sequence ID : 0x" + pad(hex_value.toString(16),2);
        }
        default :
        {
            packet_title = "Filled Data";
            if (hex_value == 255)
            {
                item_content = "Filled with 0xFF";
            }
            else
            {
                item_content = "0x" + pad(hex_value.toString(16),2) + ", should be 0xFF";
                types_title = ScanaStudio.PacketColors.Error.Title;
                types_content = ScanaStudio.PacketColors.Error.Content;
            }
        }
    }//end switch (byte)
}//end function AIS_Class_B_static_data_part_B

function Tide_Station_Data (decoder_items) //130320
{
    var str = "";
    switch (fast_packet_byte)
    {
        case 1 :
        {
            var mode = hex_value>>4;
            var tide_tendency = (hex_value>>2)&0x3;
            var reserved = hex_value&0x3;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/4*2;
            str = LOOKUP_RESIDUAL_MODE(mode);
            ScanaStudio.dec_item_new(decoder_items.channel_index,decoder_items.start_sample_index, end_item);
            ScanaStudio.dec_item_add_content("Mode : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                end_item,
                "Fast Packet Data",
                ("Mode : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            switch (tide_tendency)
            {
                case 0 :
                {
                    str = "Falling";
                    break;
                }
                case 1 :
                {
                    str = "Rising";
                    break;
                }
            }
            start_item = end_item;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/4*3;
            ScanaStudio.dec_item_new(decoder_items.channel_index, start_item, end_item);
            ScanaStudio.dec_item_add_content("Tide Tendency : " + str);
            ScanaStudio.dec_item_add_content("" + str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                end_item,
                "Fast Packet Data",
                ("Tide Tendency : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            ScanaStudio.dec_item_new(decoder_items.channel_index, end_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Reserved : 0x" + pad(reserved.toString(16),1));
            ScanaStudio.dec_item_add_content("Reserved");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                end_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("Reserved : 0x" + pad(reserved.toString(16),1)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 2 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value
            skip_item = true;
            break;
        }
        case 3 :
        {
            multi_byte_value += (hex_value<<8);
            system_time.setTime((multi_byte_value)*1000*24*3600);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Measurement Date : " + system_time.getMonth() + "/" + system_time.getDate() + "/" + system_time.getFullYear() + " (month/day/year)");
            ScanaStudio.dec_item_add_content("Measurement Date : " + system_time.getMonth() + "/" + system_time.getDate() + "/" + system_time.getFullYear());
            ScanaStudio.dec_item_add_content(system_time.getMonth() + "/" + system_time.getDate() + "/" + system_time.getFullYear());
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Measurement Date",
                (system_time.getMonth() + "/" + system_time.getDate() + "/" + system_time.getFullYear() + " (month/day/year)"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 4 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 5 :
        {
            multi_byte_value += (hex_value<<8);
            skip_item = true;
            break;
        }
        case 6 :
        {
            multi_byte_value += (hex_value<<16);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Measurement Time (LSBytes) : 0x" + pad(multi_byte_value.toString(16),6));
            ScanaStudio.dec_item_add_content("0x" + pad(multi_byte_value.toString(16),6));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Measurement Time",
                (" (LSBytes) : 0x" + pad(multi_byte_value.toString(16),6)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 7 :
        {
            ScanaStudio.dec_item_new(decoder_items.channel_index,decoder_items.start_sample_index,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Measurement Time (MSByte) : 0x" + pad(hex_value.toString(16),2));
            ScanaStudio.dec_item_add_content("0x" + pad(hex_value.toString(16),2));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                decoder_items.end_sample_index,
                "Measurement Time",
                ("(MSByte) : 0x" + pad(hex_value.toString(16),2)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 8 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 9 :
        {
            multi_byte_value += (hex_value<<8);
            skip_item = true;
            break;
        }
        case 10 :
        {
            multi_byte_value += (hex_value<<16);
            skip_item = true;
            break;
        }
        case 11 :
        {
            multi_byte_value += hex_value*Math.pow(2,24);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Station Latitude : 0x" + pad(multi_byte_value.toString(16),8));
            ScanaStudio.dec_item_add_content("0x" + pad(multi_byte_value.toString(16),8));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Station Latitude",
                ("0x" + pad(multi_byte_value.toString(16),8)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 12 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 13 :
        {
            multi_byte_value += (hex_value<<8);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Station Longitude (LSBytes) : 0x" + pad(multi_byte_value.toString(16),4));
            ScanaStudio.dec_item_add_content("0x" + pad(multi_byte_value.toString(16),4));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Station Longitude",
                ("(LSBytes) : 0x" + pad(multi_byte_value.toString(16),4)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 14 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 15 :
        {
            multi_byte_value += (hex_value<<8);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Station Longitude (MSBytes) : 0x" + pad(multi_byte_value.toString(16),4));
            ScanaStudio.dec_item_add_content("0x" + pad(multi_byte_value.toString(16),4));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Station Longitude",
                ("(MSBytes) : 0x" + pad(multi_byte_value.toString(16),4)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 16 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 17 :
        {
            multi_byte_value += (hex_value<<8);
            multi_byte_value = multi_byte_value*0.001;
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Tide Level : " + multi_byte_value.toFixed(3) + " m (Relative to MLLW)");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(3) + " m");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Tide Level",
                (multi_byte_value.toFixed(3) + " m (Relative to MLLW)"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 18 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 19 :
        {
            multi_byte_value += (hex_value<<8);
            multi_byte_value = multi_byte_value*0.01;
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Tide Level standart deviation : " + multi_byte_value.toFixed(2) + " m");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(2) + " m");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Tide Level ",
                ("Standart deviation : " + multi_byte_value.toFixed(2) + " m"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 20 :
        {
            item_content = "Station ID (LSByte) : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 21 :
        {
            item_content = "Station ID (MSByte) : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 22 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 23 :
        {
            multi_byte_value += (hex_value<<8);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Station Name : 0x" + pad(multi_byte_value.toString(16),4));
            ScanaStudio.dec_item_add_content("0x" + pad(multi_byte_value.toString(16),4));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("Station Name : 0x" + pad(multi_byte_value.toString(16),4)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        default :
        {
            packet_title = "Filled Data";
            if (hex_value == 255)
            {
                item_content = "Filled with 0xFF";
            }
            else
            {
                item_content = "0x" + pad(hex_value.toString(16),2) + ", should be 0xFF";
                types_title = ScanaStudio.PacketColors.Error.Title;
                types_content = ScanaStudio.PacketColors.Error.Content;
            }
        }
    }//end switch (byte)
}//end function Tide_Station_Data

function Watermaker_Input_Setting_and_Status (decoder_items) //130567
{
    var str = "";
    switch (fast_packet_byte)
    {
        case 1 :
        {
            var watermaker_operating_state = hex_value>>2;
            var production_start_stop = (hex_value)&0x3;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/4*3;
            switch (watermaker_operating_state)
            {
                case 0 :
                {
                    str = "Stopped";
                    break;
                }
                case 1 :
                {
                    str = "Starting";
                    break;
                }
                case 2 :
                {
                    str = "Running";
                    break;
                }
                case 3 :
                {
                    str = "Stopping";
                    break;
                }
                case 4 :
                {
                    str = "Flushing";
                    break;
                }
                case 5 :
                {
                    str = "Rinsing";
                    break;
                }
                case 6 :
                {
                    str = "Initiating";
                    break;
                }
                case 7 :
                {
                    str = "Manual Mode";
                    break;
                }
                case 62 :
                {
                    str = "Error";
                    break;
                }
                case 63 :
                {
                    str = "Unavailable";
                    break;
                }
                default :
                {
                    str = "Reserved";
                    break;
                }
            }
            ScanaStudio.dec_item_new(decoder_items.channel_index,decoder_items.start_sample_index, end_item);
            ScanaStudio.dec_item_add_content("Watermaker Operating State : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                end_item,
                "Watermaker",
                ("Operating State : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            str = LOOKUP_YES_NO(production_start_stop);
            ScanaStudio.dec_item_new(decoder_items.channel_index, end_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Production Start/Stop : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                end_item,
                decoder_items.end_sample_index,
                "Production",
                ("Start/Stop : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 2 :
        {
            var rinse_start_stop = hex_value>>6;
            var low_pressure_pump_status = (hex_value>>4)&0x3;
            var high_pressure_pump_status = (hex_value>>2)&0x3;
            var emergency_stop = hex_value&0x3;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/4;
            str = LOOKUP_YES_NO(rinse_start_stop);
            ScanaStudio.dec_item_new(decoder_items.channel_index,decoder_items.start_sample_index, end_item);
            ScanaStudio.dec_item_add_content("Rinse Start/Stop : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                end_item,
                "Rinse",
                ("Start/Stop : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            start_item = end_item;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/4*2;
            str = LOOKUP_YES_NO(low_pressure_pump_status);
            ScanaStudio.dec_item_new(decoder_items.channel_index, start_item, end_item);
            ScanaStudio.dec_item_add_content("Low Pressure Pump Status : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                end_item,
                "Low Pressure Pump",
                ("Status : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            start_item = end_item;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/4*3;
            str = LOOKUP_YES_NO(high_pressure_pump_status);
            ScanaStudio.dec_item_new(decoder_items.channel_index, start_item, end_item);
            ScanaStudio.dec_item_add_content("High Pressure Pump Status : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                end_item,
                "High Pressure Pump",
                ("Status : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            str = LOOKUP_YES_NO(emergency_stop);
            ScanaStudio.dec_item_new(decoder_items.channel_index, end_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Emergency Stop : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                end_item,
                decoder_items.end_sample_index,
                "Emergency Stop",
                ("Status : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 3 :
        {
            var product_solenoid_valve_status = hex_value>>6;
            var flush_mode_status = (hex_value>>4)&0x3;
            var salinity_status = (hex_value>>2)&0x3;
            var sensor_status = hex_value&0x3;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/4;
            str = LOOKUP_OK_WARNING(product_solenoid_valve_status);
            ScanaStudio.dec_item_new(decoder_items.channel_index,decoder_items.start_sample_index, end_item);
            ScanaStudio.dec_item_add_content("Product Solenoid Valve Status : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                end_item,
                "Product Solenoid",
                ("Valve Status : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            start_item = end_item;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/4*2;
            str = LOOKUP_YES_NO(flush_mode_status);
            ScanaStudio.dec_item_new(decoder_items.channel_index, start_item, end_item);
            ScanaStudio.dec_item_add_content("Flush Mode Status : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                end_item,
                "Flush Mode ",
                ("Status : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            start_item = end_item;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/4*3;
            str = LOOKUP_OK_WARNING(salinity_status);
            ScanaStudio.dec_item_new(decoder_items.channel_index, start_item, end_item);
            ScanaStudio.dec_item_add_content("Salinity Status : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                end_item,
                "Salinity ",
                ("Status : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            str = LOOKUP_OK_WARNING(sensor_status);
            ScanaStudio.dec_item_new(decoder_items.channel_index, end_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Sensor Status : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                end_item,
                decoder_items.end_sample_index,
                "Sensor ",
                ("Status : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 4 :
        {
            var oil_change_indicator_status = hex_value>>6;
            var filter_status = (hex_value>>4)&0x3;
            var system_status = (hex_value>>2)&0x3;
            var reserved = hex_value&0x3;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/4;
            str = LOOKUP_OK_WARNING(product_solenoid_valve_status);
            ScanaStudio.dec_item_new(decoder_items.channel_index,decoder_items.start_sample_index, end_item);
            ScanaStudio.dec_item_add_content("Oil Change Indicator Status : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                end_item,
                "Oil Change Indic ",
                ("Status : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            start_item = end_item;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/4*2;
            str = LOOKUP_OK_WARNING(flush_mode_status);
            ScanaStudio.dec_item_new(decoder_items.channel_index, start_item, end_item);
            ScanaStudio.dec_item_add_content("Filter Status : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                end_item,
                "Filter ",
                ("Status : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            start_item = end_item;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/4*3;
            str = LOOKUP_OK_WARNING(salinity_status);
            ScanaStudio.dec_item_new(decoder_items.channel_index, start_item, end_item);
            ScanaStudio.dec_item_add_content("System Status : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                end_item,
                "System ",
                ("Status : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            ScanaStudio.dec_item_new(decoder_items.channel_index, end_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Reserved : 0x" + pad(reserved.toString(16),1));
            ScanaStudio.dec_item_add_content("Reserved");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                end_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("Reserved : 0x" + pad(reserved.toString(16),1)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 5 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 6 :
        {
            multi_byte_value += (hex_value<<8);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Salinity : " + multi_byte_value + " ppm");
            ScanaStudio.dec_item_add_content(multi_byte_value + " ppm");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("Salinity : " + multi_byte_value + " ppm"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 7 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 8 :
        {
            multi_byte_value += (hex_value<<8);
            multi_byte_value = multi_byte_value*0.01;
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Product Water Temperature : " + multi_byte_value.toFixed(2) + " K");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(2) + " K");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Product Water",
                ("Temperature : " + multi_byte_value.toFixed(2) + " K"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 9 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 10 :
        {
            multi_byte_value += (hex_value<<8);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Pre-filter Pressure : " + multi_byte_value + " hPa");
            ScanaStudio.dec_item_add_content(multi_byte_value + " hPa");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Pre-filter ",
                ("Pressure : " + multi_byte_value + " hPa"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 11 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 12 :
        {
            multi_byte_value += (hex_value<<8);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Post-filter Pressure : " + multi_byte_value + " hPa");
            ScanaStudio.dec_item_add_content(multi_byte_value + " hPa");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Post-filter ",
                ("Pressure : " + multi_byte_value + " hPa"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 13 :
        {
            ScanaStudio.dec_item_new(decoder_items.channel_index,decoder_items.start_sample_index,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Feed Pressure (LSByte) : 0x" + + pad(hex_value.toString(16),2));
            ScanaStudio.dec_item_add_content("0" + pad(hex_value.toString(16),2));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                decoder_items.end_sample_index,
                "Feed ",
                ("Pressure (LSByte) : 0x" + pad(hex_value.toString(16),2)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 14 :
        {
            ScanaStudio.dec_item_new(decoder_items.channel_index,decoder_items.start_sample_index,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Feed Pressure (MSByte) : 0x" + + pad(hex_value.toString(16),2));
            ScanaStudio.dec_item_add_content("0" + pad(hex_value.toString(16),2));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                decoder_items.end_sample_index,
                "Feed ",
                ("Pressure (MSByte) : 0x" + pad(hex_value.toString(16),2)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 15 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 16 :
        {
            multi_byte_value += (hex_value<<8);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("System High Pressure : " + multi_byte_value + " kPa");
            ScanaStudio.dec_item_add_content(multi_byte_value + " kPa");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "System ",
                ("High Pressure : " + multi_byte_value + " kPa"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 17 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 18 :
        {
            multi_byte_value += (hex_value<<8);
            multi_byte_value = multi_byte_value*0.1;
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Product Water Flow : " + multi_byte_value.toFixed(1) + " L/h");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(1) + " L/h");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Product Water ",
                ("Flow : " + multi_byte_value.toFixed(1) + " L/h"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 19 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 20 :
        {
            multi_byte_value += (hex_value<<8);
            multi_byte_value = multi_byte_value*0.1;
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Brine Water Flow : " + multi_byte_value.toFixed(1) + " L/h");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(1) + " L/h");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Brine Water ",
                ("Flow : " + multi_byte_value.toFixed(1) + " L/h"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 21 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 22 :
        {
            multi_byte_value += (hex_value<<8);
            skip_item = true;
            break;
        }
        case 23 :
        {
            multi_byte_value += (hex_value<<16);
            skip_item = true;
            break;
        }
        case 24 :
        {
            multi_byte_value += hex_value*Math.pow(2,24);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Run Time : " + (multi_byte_value.toString().replace(/(\d)(?=(\d{3})+\b)/g,'$1 ')) + " s");
            ScanaStudio.dec_item_add_content((multi_byte_value.toString().replace(/(\d)(?=(\d{3})+\b)/g,'$1 ')) + " s");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("Run Time : " + (multi_byte_value.toString().replace(/(\d)(?=(\d{3})+\b)/g,'$1 ')) + " s"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        default :
        {
            packet_title = "Filled Data";
            if (hex_value == 255)
            {
                item_content = "Filled with 0xFF";
            }
            else
            {
                item_content = "0x" + pad(hex_value.toString(16),2) + ", should be 0xFF";
                types_title = ScanaStudio.PacketColors.Error.Title;
                types_content = ScanaStudio.PacketColors.Error.Content;
            }
        }
    }//end switch (byte)
}//end function Watermaker_Input_Setting_and_Status

function Vessel_Speed_Components (decoder_items) //130578
{
    var str = "";
    switch (fast_packet_byte)
    {
        case 1 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 2 :
        {
            multi_byte_value += (hex_value<<8);
            multi_byte_value = multi_byte_value*0.001;
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Longitudinal Speed, Water-referenced : " + multi_byte_value.toFixed(3) + " m/s");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(3) + " m/s");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Longitudinal Speed",
                (" Water-referenced : " + multi_byte_value.toFixed(3) + " m/s"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 3 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 4 :
        {
            multi_byte_value += (hex_value<<8);
            multi_byte_value = multi_byte_value*0.001;
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Transverse Speed, Water-referenced : " + multi_byte_value.toFixed(3) + " m/s");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(3) + " m/s");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Transverse Speed",
                (" Water-referenced : " + multi_byte_value.toFixed(3) + " m/s"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 5 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 6 :
        {
            multi_byte_value += (hex_value<<8);
            multi_byte_value = multi_byte_value*0.001;
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Longitudinal Speed, Ground-referenced : " + multi_byte_value.toFixed(3) + " m/s");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(3) + " m/s");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Longitudinal Speed",
                (" Ground-referenced : " + multi_byte_value.toFixed(3) + " m/s"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 7 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 8 :
        {
            multi_byte_value += (hex_value<<8);
            multi_byte_value = multi_byte_value*0.001;
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Transverse Speed, Ground-referenced : " + multi_byte_value.toFixed(3) + " m/s");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(3) + " m/s");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Transverse Speed",
                ("Ground-referenced : " + multi_byte_value.toFixed(3) + " m/s"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 9 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 10 :
        {
            multi_byte_value += (hex_value<<8);
            multi_byte_value = multi_byte_value*0.001;
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Stern Speed, Water-referenced : " + multi_byte_value.toFixed(3) + " m/s");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(3) + " m/s");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Stern Speed",
                ("Water-referenced : " + multi_byte_value.toFixed(3) + " m/s"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 11 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 12 :
        {
            multi_byte_value += (hex_value<<8);
            multi_byte_value = multi_byte_value*0.001;
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Stern Speed, Ground-referenced : " + multi_byte_value.toFixed(3) + " m/s");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(3) + " m/s");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Stern Speed",
                ("Ground-referenced : " + multi_byte_value.toFixed(3) + " m/s"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        default :
        {
            packet_title = "Filled Data";
            if (hex_value == 255)
            {
                item_content = "Filled with 0xFF";
            }
            else
            {
                item_content = "0x" + pad(hex_value.toString(16),2) + ", should be 0xFF";
                types_title = ScanaStudio.PacketColors.Error.Title;
                types_content = ScanaStudio.PacketColors.Error.Content;
            }
        }
    }
}//end functionVessel_Speed_Components

function NMEA (decoder_items)//126208
{
    var str = "";
    switch (fast_packet_byte)
    {
        case 1 :
        {
            switch (hex_value)
            {
                case 0 :
                {
                    str = "Request";
                    break;
                }
                case 1 :
                {
                    str = "Command";
                    break;
                }
                case 2 :
                {
                    str = "Acknowledge";
                    break;
                }
                case 3 :
                {
                    str = "Read fields";
                    break;
                }
                case 4 :
                {
                    str = "Read fields Reply";
                    break;
                }
                case 5 :
                {
                    str = "Write Fields";
                    break;
                }
                case 6 :
                {
                    str = "Write Fields Reply";
                    break;
                }
                default :
                {
                    str = "Reserved";
                    break;
                }
            }
            item_content = "Function Code : " + str;
            break;
        }
        case 2 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 3 :
        {
            multi_byte_value += (hex_value<<8);
            skip_item = true;
            break;
        }
        case 4 :
        {
            multi_byte_value += (hex_value<<16);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("PGN : " + multi_byte_value + " or 0x" + pad(multi_byte_value.toString(16),5));
            ScanaStudio.dec_item_add_content("PGN : " + multi_byte_value);
            ScanaStudio.dec_item_add_content(multi_byte_value);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("PGN : " + multi_byte_value + " or 0x" + pad(multi_byte_value.toString(16),5)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        default :
        {
            packet_title = "Data Byte n°" + fast_packet_byte;
            item_content = "0x" + pad(hex_value.toString(16),2);
            break;
        }
    }
}//end function NMEA

function Tracked_Target_Data (decoder_items) //128520
{
    var str = "";
    var name_field = false;
    if (fast_packet_byte > 25 && fast_packet_byte < 282)
    {
        name_field = true;
    }
    switch (fast_packet_byte)
    {
        case 1 :
        {
            item_content = "SID : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 2 :
        {
            item_content = "Target ID # : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 3 :
        {
            var track_status = hex_value>>6;
            var reported_target = (hex_value>>5)&0x1;
            var target_acquisition = (hex_value>>4)&0x1;
            var bearing_reference = (hex_value>>2)&0x3;
            var reserved = hex_value&0x3;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/8*2;
            switch (track_status)
            {
                case 0 :
                {
                    str = "Cancelled";
                    break;
                }
                case 1 :
                {
                    str = "Acquiring";
                    break;
                }
                case 2 :
                {
                    str = "Tracking";
                    break;
                }
                case 3 :
                {
                    str = "Lost";
                    break;
                }
            }
            ScanaStudio.dec_item_new(decoder_items.channel_index, decoder_items.start_sample_index, end_item);
            ScanaStudio.dec_item_add_content("Track Status : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                end_item,
                "Fast Packet Data",
                ("Track Status : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            start_item = end_item;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/8*3;
            str = LOOKUP_YES_NO(reported_target);
            ScanaStudio.dec_item_new(decoder_items.channel_index, start_item, end_item);
            ScanaStudio.dec_item_add_content("Reported Target : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                end_item,
                "Fast Packet Data",
                ("Reported Target : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            start_item = end_item;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/8*4;
            switch (target_acquisition)
            {
                case 0 :
                {
                    str = "Manual";
                    break;
                }
                case 1 :
                {
                    str = "Automatic";
                    break;
                }
            }
            ScanaStudio.dec_item_new(decoder_items.channel_index, start_item, end_item);
            ScanaStudio.dec_item_add_content("Target Acquisition : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                end_item,
                "Fast Packet Data",
                ("Target Acquisition : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            str = LOOKUP_DIRECTION_REFERENCE(bearing_reference);
            start_item = end_item;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/8*6;
            ScanaStudio.dec_item_new(decoder_items.channel_index, start_item, end_item);
            ScanaStudio.dec_item_add_content("Bearing Reference : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                end_item,
                "Fast Packet Data",
                ("Bearing Reference : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            ScanaStudio.dec_item_new(decoder_items.channel_index, end_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Reserved : 0x" + pad(reserved.toString(16),1));
            ScanaStudio.dec_item_add_content("0x" + pad(reserved.toString(16),1));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                end_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("Reserved : 0x" + pad(reserved.toString(16),1)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 4 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 5 :
        {
            multi_byte_value += (hex_value<<8);
            multi_byte_value = multi_byte_value/10000;
            ScanaStudio.dec_item_new(decoder_items.channel_index, start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Bearing : " + multi_byte_value.toFixed(4) + " rad");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(4) + " rad");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("Bearing : " + multi_byte_value.toFixed(4) + " rad"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 6 :
        {
            item_content = "Distance (LSByte) : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 7 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 8 :
        {
            multi_byte_value += (hex_value<<8);
            skip_item = true;
            break;
        }
        case 9 :
        {
            multi_byte_value += (hex_value<<16);
            ScanaStudio.dec_item_new(decoder_items.channel_index, start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Distance (MSBytes) : 0x" + pad(multi_byte_value.toString(16),6));
            ScanaStudio.dec_item_add_content("0x" + pad(multi_byte_value.toString(16),6));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("Distance (MSBytes) : 0x" + pad(multi_byte_value.toString(16),6)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 10 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 11 :
        {
            multi_byte_value += (hex_value<<8);
            multi_byte_value = multi_byte_value/10000;
            ScanaStudio.dec_item_new(decoder_items.channel_index, start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Course : " + multi_byte_value.toFixed(4) + " rad");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(4) + " rad");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("Course : " + multi_byte_value.toFixed(4) + " rad"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 12 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 13 :
        {
            multi_byte_value += (hex_value<<8);
            multi_byte_value = multi_byte_value*0.01;
            ScanaStudio.dec_item_new(decoder_items.channel_index, start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Speed : " + multi_byte_value.toFixed(2) + " m/s");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(2) + " m/s");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("Speed : " + multi_byte_value.toFixed(2) + " m/s"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 14 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 15 :
        {
            multi_byte_value += (hex_value<<8);
            skip_item = true;
            break;
        }
        case 16 :
        {
            multi_byte_value += (hex_value<<16);
            skip_item = true;
            break;
        }
        case 17 :
        {
            multi_byte_value += hex_value*Math.pow(2,24);
            multi_byte_value = multi_byte_value*0.01;
            ScanaStudio.dec_item_new(decoder_items.channel_index, start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("CPA : " + multi_byte_value.toFixed(2).toString().replace(/(\d)(?=(\d{3})+\b)/g,'$1 ') + " m/s");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(2).toString().replace(/(\d)(?=(\d{3})+\b)/g,'$1 ') + " m/s");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("CPA : " + multi_byte_value.toFixed(2).toString().replace(/(\d)(?=(\d{3})+\b)/g,'$1 ') + " m/s"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 18 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 19 :
        {
            multi_byte_value += (hex_value<<8);
            skip_item = true;
            break;
        }
        case 20 :
        {
            multi_byte_value += (hex_value<<16);
            ScanaStudio.dec_item_new(decoder_items.channel_index, start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("TCPA (LSBytes) : 0x" + pad(multi_byte_value.toString(16),6));
            ScanaStudio.dec_item_add_content("0x" + pad(multi_byte_value.toString(16),6));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("TCPA (LSBytes) : 0x" + pad(multi_byte_value.toString(16),6)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 21 :
        {
            item_content = "TCPA (MSByte) : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 22 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 23 :
        {
            multi_byte_value += (hex_value<<8);
            skip_item = true;
            break;
        }
        case 24 :
        {
            multi_byte_value += (hex_value<<16);
            skip_item = true;
            break;
        }
        case 25 :
        {
            multi_byte_value += hex_value*Math.pow(2,24);
            system_time.setTime((multi_byte_value/10)-(3600*1000)); // the Date object is initialize the 1 january, 1970 at 1am
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("UTC of Fix : " + system_time.getHours() + "h" + system_time.getMinutes() + "min" + system_time.getSeconds() + "sec");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Data",
                ("UTC of Fix : " + system_time.getHours() + "h" + system_time.getMinutes() + "min" + system_time.getSeconds() + "sec"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        default :
        {
            if (name_field == true)
            {
                item_content = "Name : " + "'" + String.fromCharCode(hex_value) + "'";
                break;
            }
            else
            {
                packet_title = "Filled Data";
                if (hex_value == 255)
                {
                    item_content = "Filled with 0xFF";
                }
                else
                {
                    item_content = "0x" + pad(hex_value.toString(16),2) + ", should be 0xFF";
                    types_title = ScanaStudio.PacketColors.Error.Title;
                    types_content = ScanaStudio.PacketColors.Error.Content;
                }
            }
        }
    }//end switch (fast_packet_byte)
}//end function Tracked_Target_Data

function Salinity_Station_Data (decoder_items) //130321
{
    var str = "";
    switch (fast_packet_byte)
    {
        case 1 :
        {
            var mode = hex_value>>4;
            var reserved = hex_value&0xF;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/2;
            str = LOOKUP_RESIDUAL_MODE(mode);
            ScanaStudio.dec_item_new(decoder_items.channel_index, decoder_items.start_sample_index, end_item);
            ScanaStudio.dec_item_add_content("Mode : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                end_item,
                "Fast Packet Data",
                ("Mode : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            ScanaStudio.dec_item_new(decoder_items.channel_index, end_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Reserved : 0x" + pad(reserved.toString(16),1));
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                end_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("Reserved : 0x" + pad(reserved.toString(16),1)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 2 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value
            skip_item = true;
            break;
        }
        case 3 :
        {
            multi_byte_value += (hex_value<<8);
            system_time.setTime((multi_byte_value)*1000*24*3600);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Measurement Date : " + system_time.getMonth() + "/" + system_time.getDate() + "/" + system_time.getFullYear() + " (month/day/year)");
            ScanaStudio.dec_item_add_content("Measurement Date : " + system_time.getMonth() + "/" + system_time.getDate() + "/" + system_time.getFullYear());
            ScanaStudio.dec_item_add_content(system_time.getMonth() + "/" + system_time.getDate() + "/" + system_time.getFullYear());
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Measurement Date",
                (system_time.getMonth() + "/" + system_time.getDate() + "/" + system_time.getFullYear() + " (month/day/year)"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 4 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 5 :
        {
            multi_byte_value += (hex_value<<8);
            skip_item = true;
            break;
        }
        case 6 :
        {
            multi_byte_value += (hex_value<<16);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Measurement Time (LSBytes) : 0x" + pad(multi_byte_value.toString(16),6));
            ScanaStudio.dec_item_add_content("0x" + pad(multi_byte_value.toString(16),6));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Measurement Time",
                (" (LSBytes) : 0x" + pad(multi_byte_value.toString(16),6)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 7 :
        {
            ScanaStudio.dec_item_new(decoder_items.channel_index,decoder_items.start_sample_index,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Measurement Time (MSByte) : 0x" + pad(hex_value.toString(16),2));
            ScanaStudio.dec_item_add_content("0x" + pad(hex_value.toString(16),2));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                decoder_items.end_sample_index,
                "Measurement Time",
                (" (MSByte) : 0x" + pad(hex_value.toString(16),2)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 8 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 9 :
        {
            multi_byte_value += (hex_value<<8);
            skip_item = true;
            break;
        }
        case 10 :
        {
            multi_byte_value += (hex_value<<16);
            skip_item = true;
            break;
        }
        case 11 :
        {
            multi_byte_value += hex_value*Math.pow(2,24);
            ScanaStudio.dec_item_new(decoder_items.channel_index, start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Station Latitude : 0x" + pad(multi_byte_value.toString(16),8));
            ScanaStudio.dec_item_add_content("0x" + pad(multi_byte_value.toString(16),8));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Station",
                ("Latitude : 0x" + pad(multi_byte_value.toString(16),8)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 12 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 13 :
        {
            multi_byte_value += (hex_value<<8);
            ScanaStudio.dec_item_new(decoder_items.channel_index, start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Station Longitude (LSBytes) : 0x" + pad(multi_byte_value.toString(16),4));
            ScanaStudio.dec_item_add_content("0x" + pad(multi_byte_value.toString(16),4));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Station",
                ("Longitude (LSBytes) : 0x" + pad(multi_byte_value.toString(16),4)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 14 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 15 :
        {
            multi_byte_value += (hex_value<<8);
            ScanaStudio.dec_item_new(decoder_items.channel_index, start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Station Longitude (MSBytes) : 0x" + pad(multi_byte_value.toString(16),4));
            ScanaStudio.dec_item_add_content("0x" + pad(multi_byte_value.toString(16),4));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Station",
                ("Longitude (MSBytes) : 0x" + pad(multi_byte_value.toString(16),4)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 16 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 17 :
        {
            multi_byte_value += (hex_value<<8);
            skip_item = true;
            break;
        }
        case 18 :
        {
            multi_byte_value += (hex_value<<16);
            skip_item = true;
            break;
        }
        case 19 :
        {
            multi_byte_value += hex_value*Math.pow(2,24);
            ScanaStudio.dec_item_new(decoder_items.channel_index, start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Salinity : 0x" + pad(multi_byte_value.toString(16),8));
            ScanaStudio.dec_item_add_content("0x" + pad(multi_byte_value.toString(16),8));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("Salinity : 0x" + pad(multi_byte_value.toString(16),8)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 20 :
        {
            ScanaStudio.dec_item_new(decoder_items.channel_index, decoder_items.start_sample_index, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Water Temperature (LSByte) : 0x" + pad(hex_value.toString(16),2));
            ScanaStudio.dec_item_add_content("0x" + pad(multi_byte_value.toString(16),2));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                decoder_items.end_sample_index,
                "Water Temperature",
                ("(LSByte) : 0x" + pad(multi_byte_value.toString(16),2)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 21 :
        {
            ScanaStudio.dec_item_new(decoder_items.channel_index, decoder_items.start_sample_index, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Water Temperature (MSByte) : 0x" + pad(hex_value.toString(16),2));
            ScanaStudio.dec_item_add_content("0x" + pad(multi_byte_value.toString(16),2));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                decoder_items.end_sample_index,
                "Water Temperature",
                ("(MSByte) : 0x" + pad(multi_byte_value.toString(16),2)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 22 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 23 :
        {
            multi_byte_value += (hex_value<<8);
            ScanaStudio.dec_item_new(decoder_items.channel_index, start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Station ID : 0x" + pad(multi_byte_value.toString(16),4));
            ScanaStudio.dec_item_add_content("0x" + pad(multi_byte_value.toString(16),4));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("Station ID : 0x" + pad(multi_byte_value.toString(16),4)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 24 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 25 :
        {
            multi_byte_value += (hex_value<<8);
            ScanaStudio.dec_item_new(decoder_items.channel_index, start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Station Name : 0x" + pad(multi_byte_value.toString(16),4));
            ScanaStudio.dec_item_add_content("0x" + pad(multi_byte_value.toString(16),4));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("Station ID : 0x" + pad(multi_byte_value.toString(16),4)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        default :
        {
            packet_title = "Filled Data";
            if (hex_value == 255)
            {
                item_content = "Filled with 0xFF";
            }
            else
            {
                item_content = "0x" + pad(hex_value.toString(16),2) + ", should be 0xFF";
                types_title = ScanaStudio.PacketColors.Error.Title;
                types_content = ScanaStudio.PacketColors.Error.Content;
            }
        }
    }//end switch (fast_packet_byte)
}//end function Salinity_Station_Data


//------------------------------------------------------------------------------------------------------------------------------------------//
//                                                          END FAST-PACKET PGN                                                             //
//------------------------------------------------------------------------------------------------------------------------------------------//

//------------------------------------------------------------------------------------------------------------------------------------------//
//                                                      Proprietary FAST-PACKET PGN                                                         //
//------------------------------------------------------------------------------------------------------------------------------------------//

function proprietary_fast_packet (decoder_items) //126720/130816/130817/130818/130819/130820/130821/130824/130827/130828/130831/130832/130834/130835/130836/130837/130838/130839/130840/130842/130843/130845/130847/130850/130851/130856/130880/130881/130944
{
    var str = "";
    switch (fast_packet_byte)
    {
        case 1 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 2 :
        {
            var manufacturer_code = multi_byte_value + (((hex_value>>5)&0x7)<<8);
            var reserved = (hex_value>>3)&0x3;
            var industry_code = hex_value&0x7;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/8*3;
            str = LOOKUP_MANUFACTURER(manufacturer_code);
            ScanaStudio.dec_item_new(decoder_items.channel_index, start_item, end_item);
            ScanaStudio.dec_item_add_content("Manufacturer Code : " + str);
            ScanaStudio.dec_item_add_content("" + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                end_item,
                "Fast Packet Data",
                ("Manufacturer Code : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            start_item = end_item;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/8*5;
            ScanaStudio.dec_item_new(decoder_items.channel_index, start_item, end_item);
            ScanaStudio.dec_item_add_content("Reserved : 0x" + pad(reserved.toString(16),1));
            ScanaStudio.dec_item_add_content("Reserved");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                end_item,
                "Fast Packet Data",
                ("Reserved : 0x" + pad(reserved.toString(16),1)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            str = LOOKUP_INDUSTRY_CODE(industry_code);
            ScanaStudio.dec_item_new(decoder_items.channel_index, end_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Industry Code : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                end_item,
                decoder_items.end_sample_index,
                "Fast Packet Data",
                ("Industry Code : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        default :
        {
            packet_title = "Byte n°" + fast_packet_byte;
            item_content = "0x" + pad(hex_value.toString(16),2);
            break;
        }
    }
}



//------------------------------------------------------------------------------------------------------------------------------------------//
//                                                   END Proprietary FAST-PACKET PGN                                                        //
//------------------------------------------------------------------------------------------------------------------------------------------//

//------------------------------------------------------------------------------------------------------------------------------------------//
//                                                          LOOKUP FUNCTIONS                                                                //
//------------------------------------------------------------------------------------------------------------------------------------------//

function LOOKUP_MANUFACTURER (value)
{
    switch (value)
    {
        case 199 :
        {
            return "Actia Corporation";
        }
        case 273 :
        {
            return "Actisense";
        }
        case 215 :
        {
            return "Aetna Engineering/Fireboy-Xintex";
        }
        case 135 :
        {
            return "Airmar";
        }
        case 459 :
        {
            return "Alltek";
        }
        case 274 :
        {
            return "Amphenol LTW";
        }
        case 502 :
        {
            return "Attwood";
        }
        case 381 :
        {
            return "B&G";
        }
        case 185 :
        {
            return "Beede Electrical";
        }
        case 295 :
        {
            return "BEP";
        }
        case 396 :
        {
            return "Beyond Measure";
        }
        case 148 :
        {
            return "Blue Water Data";
        }
        case 163 :
        {
            return "Evinrude/Bombardier";
        }
        case 394 :
        {
            return "CAPI 2";
        }
        case 176 :
        {
            return "Carling";
        }
        case 165 :
        {
            return "CPAC";
        }
        case 286 :
        {
            return "Coelmo";
        }
        case 404 :
        {
            return "ComNav";
        }
        case 440 :
        {
            return "Cummins";
        }
        case 329 :
        {
            return "Dief";
        }
        case 437 :
        {
            return "Digital Yacht";
        }
        case 201 :
        {
            return "Disenos Y Technologia";
        }
        case 211 :
        {
            return "DNA Group";
        }
        case 426 :
        {
            return "Egersund Marine";
        }
        case 373 :
        {
            return "Electronic Design";
        }
        case 427 :
        {
            return "Em-Trak";
        }
        case 224 :
        {
            return "EMMI Network";
        }
        case 304 :
        {
            return "Empirbus";
        }
        case 243 :
        {
            return "eRide";
        }
        case 1863 :
        {
            return "Faria Instruments";
        }
        case 356 :
        {
            return "Fischer Panda";
        }
        case 192 :
        {
            return "Floscan";
        }
        case 1855 :
        {
            return "Furuno";
        }
        case 419 :
        {
            return "Fusion";
        }
        case 78 :
        {
            return "FW Murphy";
        }
        case 229 :
        {
            return "Garmin";
        }
        case 385 :
        {
            return "Geonav";
        }
        case 378 :
        {
            return "Glendinning";
        }
        case 475 :
        {
            return "GME / Standard";
        }
        case 272 :
        {
            return "Groco";
        }
        case 283 :
        {
            return "Hamilton Jet";
        }
        case 88 :
        {
            return "Hemisphere GPS";
        }
        case 257 :
        {
            return "Honda";
        }
        case 467 :
        {
            return "Hummingbird";
        }
        case 315 :
        {
            return "ICOM";
        }
        case 1853 :
        {
            return "JRC";
        }

        case 1859 :
        {
            return "Kvasar";
        }
        case 85 :
        {
            return "Kohler";
        }
        case 345 :
        {
            return "Korea Maritime University";
        }

        case 499 :
        {
            return "LCJ Capteurs";
        }
        case 1858 :
        {
            return "Litton";
        }
        case 400 :
        {
            return "Livorsi";
        }
        case 140 :
        {
            return "Lowrance";
        }
        case 137 :
        {
            return "Maretron";
        }
        case 571 :
        {
            return "Marinecraft (SK)";
        }
        case 307 :
        {
            return "MBW";
        }
        case 355 :
        {
            return "Mastervolt";
        }
        case 144 :
        {
            return "Mercury";
        }
        case 1860 :
        {
            return "MMP";
        }
        case 198 :
        {
            return "Mystic Valley Comms529";
        }
        case 529 :
        {
            return "National Instruments";
        }
        case 147 :
        {
            return "Nautibus";
        }
        case 275 :
        {
            return "Navico";
        }
        case 1852 :
        {
            return "Navionics";
        }

        case 503 :
        {
            return "Naviop";
        }
        case 193 :
        {
            return "Nobeltec";
        }
        case 517 :
        {
            return "Noland";
        }
        case 374 :
        {
            return "Northern Lights";
        }
        case 1854 :
        {
            return "Northstar";
        }
        case 305 :
        {
            return "Novatel";
        }
        case 478 :
        {
            return "Ocean Sat";
        }
        case 161 :
        {
            return "Offshore Systems";
        }
        case 573 :
        {
            return "Orolia (McMurdo)";
        }
        case 328 :
        {
            return "Qwerty";
        }
        case 451 :
        {
            return "Parker Hannifin";
        }
        case 1851 :
        {
            return "Raymarine";
        }
        case 370 :
        {
            return "Rolls Royce";
        }
        case 384 :
        {
            return "Rose Point";
        }
        case 235 :
        {
            return "SailorMade/Tetra";
        }
        case 580 :
        {
            return "San Jose";
        }
        case 460 :
        {
            return "San Giorgio";
        }
        case 1862 :
        {
            return "Sanshin (Yamaha)";
        }
        case 471 :
        {
            return "Sea Cross";
        }
        case 285 :
        {
            return "Sea Recovery";
        }
        case 1857 :
        {
            return "Simrad";
        }
        case 470 :
        {
            return "Sitex";
        }
        case 306 :
        {
            return "Sleipner";
        }
        case 1850 :
        {
            return "Teleflex";
        }
        case 351 :
        {
            return "Thrane and Thrane";
        }
        case 431 :
        {
            return "Tohatsu";
        }
        case 518 :
        {
            return "Transas";
        }
        case 1856 :
        {
            return "Trimble";
        }
        case 422 :
        {
            return "True Heading";
        }
        case 80 :
        {
            return "Twin Disc";
        }
        case 591 :
        {
            return "US Coast Guard";
        }
        case 1861 :
        {
            return "Vector Cantech";
        }
        case 466 :
        {
            return "Veethree";
        }
        case 421 :
        {
            return "Vertex";
        }
        case 504 :
        {
            return "Vesper";
        }
        case 358 :
        {
            return "Victron";
        }
        case 174 :
        {
            return "Volvo Penta";
        }
        case 493 :
        {
            return "Watcheye";
        }
        case 154 :
        {
            return "Westerbeke";
        }
        case 168 :
        {
            return "Xantrex";
        }
        case 583 :
        {
            return "Yachtcontrol";
        }
        case 233 :
        {
            return "Yacht Monitoring Solutions";
        }
        case 172 :
        {
            return "Yanmar";
        }
        case 228 :
        {
            return "ZF";
        }
    }
}//end function LOOKUP_MANUFACTURER

function LOOKUP_INDUSTRY_CODE (value)
{
    switch (value)
    {
        case 0 :
        {
            return "Global";
        }
        case 1 :
        {
            return "Highway";
        }
        case 2 :
        {
            return "Agriculture";
        }
        case 3 :
        {
            return "Construction";
        }
        case 4 :
        {
            return "Marine";
        }
        case 5 :
        {
            return "Industrial";
        }
        default :
        {
            return "Unknown";
        }
    }
}//end function LOOKUP_INDUSTRY_CODE

function LOOKUP_REPEAT_INDICATOR(value)
{
    switch (value)
    {
        case 0 :
        {
            return "Initial";
        }
        case 1 :
        {
            return "First retransmission";
        }
        case 2 :
        {
            return "Second retransmission";
        }
        case 3 :
        {
            return "Final retransmission";
        }
        default :
        {
            return "Reserved";
        }
    }
}//end function LOOKUP_REPEAT_INDICATOR

function LOOKUP_POSITION_ACCURACY(value)
{
    switch (value)
    {
         case 0 :
         {
             return "Low";
         }
         case 1 :
         {
             return "High";
         }
    }
}//end function LOOKUP_POSITION_ACCURACY.

function LOOKUP_RAIM_FLAG(value)
{
    switch (value)
    {
         case 0 :
         {
             return "Not in use";
         }
         case 1 :
         {
             return "In use";
         }
    }
}//end function LOOKUP_RAIM_FLAG

function LOOKUP_TIME_STAMP(value)
{
    switch (value)
    {
         case 60 :
         {
             return "Not available";
         }
         case 61 :
         {
             return "Manual input mode";
         }
         case 62 :
         {
             return "Dead reckoning mode";
         }
         case 63 :
         {
             return "Positioning system is inoperative";
         }
         default :
         {
             return "UTC s when report was generated";
         }
    }
}//end function LOOKUP_TIME_STAMP

function LOOKUP_AIS_TRANSCEIVER(value)
{
    switch (value)
    {
         case 0 :
         {
             return "Channel A VDL reception";
         }
         case 1 :
         {
             return "Channel B VDL reception";
         }
         case 2 :
         {
             return "Channel A VDL transmission";
         }
         case 3 :
         {
             return "Channel B VDL transmission";
         }
         case 4 :
         {
             return "Own information not broadcast";
         }
         default :
         {
             return "Reserved";
         }
    }
}//end function LOOKUP_AIS_TRANSCEIVER

function LOOKUP_NAV_STATUS(value)
{
    switch (value)
    {
        case 0 :
        {
            return "Under way using engine";
        }
        case 1 :
        {
            return "At anchor";
        }
        case 2 :
        {
            return "Not under command";
        }
        case 3 :
        {
            return "Restricted manoeuverability";
        }
        case 4 :
        {
            return "Constrained by her draught";
        }
        case 5 :
        {
            return "Moored";
        }
        case 6 :
        {
            return "Aground";
        }
        case 7 :
        {
            return "Engaged in Fishing";
        }
        case 8 :
        {
            return "Under way sailing";
        }
        case 9 :
        {
            return "Hazardous material - High Speed";
        }
        case 10 :
        {
            return "Hazardous material-Wing in Ground";
        }
        case 14 :
        {
            return "AIS-SART";
        }
        default :
        {
            return "Reserved";
        }
    }
}//end function LOOKUP_NAV_STATUS

function LOOKUP_AIS_SPECIAL_MANEUVER(value)
{
    switch (value)
    {
        case 0 :
        {
            return "Not available";
        }
        case 1 :
        {
            return "Not engaged in special maneuver";
        }
        case 2 :
        {
            return "Engaged in special maneuver";
        }
        default :
        {
            return "Reserved";
        }
    }
}//end function LOOKUP_AIS_SPECIAL_MANEUVER

function LOOKUP_YES_NO (value)
{
    switch (value)
    {
        case 0 :
        {
            return "No";
        }
        case 1 :
        {
            return "Yes";
        }
        case 2 :
        {
            return "Error";
        }
        case 3 :
        {
            return "Unavailable";
        }
        default :
        {
            return "Reserved";
        }
    }
}//end function LOOKUP_YES_NO

function LOOKUP_PRESSURE_SOURCE(value)
{
    var str = "";
    switch (value)
    {
        case 0 :
        {
            str = "Atmospheric";
            break;
        }
        case 1 :
        {
            str = "Water";
            break;
        }
        case 2 :
        {
            str = "Steam";
            break;
        }
        case 3 :
        {
            str = "Compressed Air";
            break;
        }
        case 4 :
        {
            str = "Hydraulic";
            break;
        }
        default :
        {
            str = "Reserved";
            break;
        }
    }
    return str;
}//end function LOOKUP_PRESSURE_SOURCE

function LOOKUP_HUMIDITY_SOURCE (value)
{
    var str = "";
    switch (value)
    {
        case 0 :
        {
            str = "Inside";
            break;
        }
        case 1 :
        {
            str = "Outside";
            break;
        }
        default :
        {
            str = "Reserved";
            break;
        }
    }
    return str;
}//end function LOOKUP_HUMIDITY_SOURCE

function LOOKUP_TEMPERATURE_SOURCE (value)
{
    var str = "";
    switch (value)
    {
        case 0 :
        {
            str = "Sea Temperature";
            break;
        }
        case 1 :
        {
            str = "Outside Temperature";
            break;
        }
        case 2 :
        {
            str = "Inside Temperature";
            break;
        }
        case 3 :
        {
            str = "Engine Room Temperature";
            break;
        }
        case 4 :
        {
            str = "Main Cabin Temperature";
            break;
        }
        case 5 :
        {
            str = "Live Well Temperature";
            break;
        }
        case 6 :
        {
            str = "Bait Well Temperature";
            break;
        }

        case 7 :
        {
            str = "Refridgeration Temperature";
            break;
        }
        case 8 :
        {
            str = "Heating System Temperature";
            break;
        }
        case 9 :
        {
            str = "Dew Point Temperature";
            break;
        }
        case 10 :
        {
            str = "Apparent Wind Chill Temperature";
            break;
        }
        case 11 :
        {
            str = "Theoretical Wind Chill Temperature";
            break;
        }
        case 12 :
        {
            str = "Heat Index Temperature";
            break;
        }
        case 13 :
        {
            str = "Freezer Temperature";
            break;
        }
        case 14 :
        {
            str = "Exhaust Gas Temperature";
            break;
        }
        default :
        {
            str = "Reserved";
            break;
        }
    }
    return str;
}//end function LOOKUP_TEMPERATURE_SOURCE

function LOOKUP_OK_WARNING(value)
{
    switch (value)
    {
        case 0 :
        {
            return "OK";
        }
        case 1 :
        {
            return "Warning";
        }
        case 2 :
        {
            return "Error";
        }
        case 3 :
        {
            return "Unavailable, Unknown";
        }
        default :
        {
            return "Reserved";
        }
    }
}//end function LOOKUP_OK_WARNING

function LOOKUP_RESIDUAL_MODE(value)
{
    switch (value)
    {
        case 0 :
        {
            return "Autonomous";
        }
        case 1 :
        {
            return "Differential enhanced";
        }
        case 2 :
        {
            return "Estimated";
        }
        case 3 :
        {
            return "Simulator";
        }
        case 4 :
        {
            return "Manual";
        }
    }
}//end function LOOKUP_RESIDUAL_MODE


function LOOKUP_DIRECTION_REFERENCE(value)
{
    switch (value)
    {
        case 0 :
        {
            return "True";
        }
        case 1 :
        {
            return "Magnetic";
        }
        case 2 :
        {
            return "Error";
        }
        case 3 :
        {
            return "Null";
        }
    }
}//end function LOOKUP_DIRECTION_REFERENCE

function LOOKUP_POSITION_FIX_DEVICE(value)
{

    switch (value)
    {
        case 0 :
        {
            return "Default: undefined";
        }
        case 1 :
        {
            return "GPS";
        }
        case 2 :
        {
            return "GLONASS";
        }
        case 3 :
        {
            return "Combined GPS/GLONASS";
        }
        case 4 :
        {
            return "Loran-C";
        }
        case 5 :
        {
            return "Chayka";
        }
        case 6 :
        {
            return "Integrated navigation system";
        }
        case 7 :
        {
            return "Surveyed";
        }
        case 8 :
        {
            return "Galileo";
        }
        case 15 :
        {
            return "Internal GNSS";
        }
        default :
        {
            return "Reserved";
        }
    }
}//end function LOOKUP_POSITION_FIX_DEVICE

function LOOKUP_AIS_ASSIGNED_MODE(value)
{
    switch (value)
    {
        case 0 :
        {
            return "Autonomous and continuous";
        }
        case 1 :
        {
            return "Assigned mode";
        }
    }
}//end function LOOKUP_AIS_ASSIGNED_MODE


function LOOKUP_ATON_TYPE(value)
{
    switch (value)
    {
        case 0 :
        {
            return "Default: Type of AtoN not specified";
        }
        case 1 :
        {
            return "Referece point";
        }
        case 2 :
        {
            return "RACON";
        }
        case 3 :
        {
            return "Fixed structure off-shore";
        }
        case 4 :
        {
            return "Reserved for future use";
        }
        case 5 :
        {
            return "Fixed light: without sectors";
        }
        case 6 :
        {
            return "Fixed light: with sectors";
        }
        case 7 :
        {
            return "Fixed leading light front";
        }
        case 8 :
        {
            return "Fixed leading light rear";
        }
        case 9 :
        {
            return "Fixed beacon: cardinal N";
        }
        case 10 :
        {
            return "Fixed beacon: cardinal E";
        }
        case 11 :
        {
            return "Fixed beacon: cardinal S";
        }
        case 12 :
        {
            return "Fixed beacon: cardinal W";
        }
        case 13 :
        {
            return "Fixed beacon: port hand";
        }
        case 14 :
        {
            return "Fixed beacon: starboard hand";
        }
        case 15 :
        {
            return "Fixed beacon: preferred channel port hand";
        }
        case 16 :
        {
            return "Fixed beacon: preferred channel starboard hand";
        }
        case 17 :
        {
            return "Fixed beacon: isolated danger";
        }
        case 18 :
        {
            return "Fixed beacon: safe water";
        }
        case 19 :
        {
            return "Fixed beacon: special mark";
        }
        case 20 :
        {
            return "Floating AtoN: cardinal N";
        }
        case 21 :
        {
            return "Floating AtoN: cardinal E";
        }
        case 22 :
        {
            return "Floating AtoN: cardinal S";
        }
        case 23 :
        {
            return "Floating AtoN: cardinal W";
        }
        case 24 :
        {
            return "Floating AtoN: port hand mark";
        }
        case 25 :
        {
            return "Floating AtoN: starboard hand mark";
        }
        case 26 :
        {
            return "Floating AtoN: preferred channel port hand";
        }
        case 27 :
        {
            return "Floating AtoN: preferred channel starboard hand";
        }
        case 28 :
        {
            return "Floating AtoN: isolated danger";
        }
        case 29 :
        {
            return "Floating AtoN: safe water";
        }
        case 30 :
        {
            return "Floating AtoN: special mark";
        }
        case 31 :
        {
            return "Floating AtoN: light vessel/LANBY/rigs";
        }
    }
}//end function LOOKUP_ATON_TYPE

function LOOKUP_GNS_AIS(value)
{
    switch (value)
    {
        case 0 :
        {
            return "undefined";
        }
        case 1 :
        {
            return "GPS";
        }
        case 2 :
        {
            return "GLONASS";
        }
        case 3 :
        {
            return "GPS+GLONASS";
        }
        case 4 :
        {
            return "Loran-C";
        }
        case 5 :
        {
            return "Chayka";
        }
        case 6 :
        {
            return "integrated";
        }
        case 7 :
        {
            return "surveyed";
        }
        case 8 :
        {
            return "Galileo";
        }
        default :
        {
            return "Reserved";
        }
    }
}//end function LOOKUP_GNS_AIS

function LOOKUP_SHIP_TYPE(value)
{
    switch (value)
    {
        case 0 :
        {
            return "unavailable";
        }
        case 20 :
        {
            return "Wing In Ground";
        }
        case 29 :
        {
            return "Wing In Ground (no other information)";
        }
        case 30 :
        {
            return "Fishing";
        }
        case 31 :
        {
            return "Towing";
        }
        case 32 :
        {
            return "Towing exceeds 200m or wider than 25m";
        }
        case 33 :
        {
            return "Engaged in dredging or underwater operations";
        }
        case 34 :
        {
            return "Engaged in diving operations";
        }
        case 35 :
        {
            return "Engaged in military operations";
        }
        case 36 :
        {
            return "Sailing";
        }
        case 37 :
        {
            return "Pleasure";
        }
        case 40 :
        {
            return "High speed craft";
        }
        case 41 :
        {
            return "High speed craft carrying dangerous goods";
        }
        case 42 :
        {
            return "High speed craft hazard cat B";
        }
        case 43 :
        {
            return "High speed craft hazard cat C";
        }
        case 44 :
        {
            return "High speed craft hazard cat D";
        }
        case 49 :
        {
            return "High speed craft (no additional information)";
        }
        case 50 :
        {
            return "Pilot vessel";
        }
        case 51 :
        {
            return "SAR";
        }
        case 52 :
        {
            return "Tug";
        }
        case 53 :
        {
            return "Port tender";
        }
        case 54 :
        {
            return "Anti-pollution";
        }
        case 55 :
        {
            return "Law enforcement";
        }
        case 56 :
        {
            return "Spare";
        }
        case 57 :
        {
            return "Spare #2";
        }
        case 58 :
        {
            return "Medical";
        }
        case 59 :
        {
            return "RR Resolution No.18";
        }
        case 60 :
        {
            return "Passenger ship";
        }
        case 69 :
        {
            return "Passenger ship (no additional information)";
        }
        case 70 :
        {
            return "Cargo ship";
        }
        case 71 :
        {
            return "Cargo ship carrying dangerous goods";
        }
        case 72 :
        {
            return "Cargo ship hazard cat B";
        }
        case 73 :
        {
            return "Cargo ship hazard cat C";
        }
        case 74 :
        {
            return "Cargo ship hazard cat D";
        }
        case 79 :
        {
            return "Cargo ship (no additional information)";
        }
        case 80 :
        {
            return "Tanker";
        }
        case 81 :
        {
            return "Tanker carrying dangerous goods";
        }
        case 82 :
        {
            return "Tanker hazard cat B";
        }
        case 83 :
        {
            return "Tanker hazard cat C";
        }
        case 84 :
        {
            return "Tanker hazard cat D";
        }
        case 89 :
        {
            return "Tanker (no additional information)";
        }
        case 90 :
        {
            return "Other";
        }
        case 91 :
        {
            return "Other carrying dangerous goods";
        }
        case 92 :
        {
            return "Other hazard cat B";
        }
        case 93 :
        {
            return "Other hazard cat C";
        }
        case 94 :
        {
            return "Other hazard cat D";
        }
        case 99 :
        {
            return "Other (no additional information)";
        }
        default :
        {
            return "Reserved"
        }
    }
}//end function LOOKUP_SHIP_TYPE

function LOOKUP_ENGINE_STATUS_1(value)
{
    switch (value)
    {
        case 0 :
        {
            return "Check Engine";
        }
        case 1 :
        {
            return "Over Temperature";
        }
        case 2 :
        {
            return "Low Oil Pressure";
        }
        case 3 :
        {
            return "Low Oil Level";
        }
        case 4 :
        {
            return "Low Fuel Pressure";
        }
        case 5 :
        {
            return "Low System Voltage";
        }
        case 6 :
        {
            return "Low Coolant Level";
        }
        case 7 :
        {
            return "Water Flow";
        }
        case 8 :
        {
            return "Water In Fuel";
        }
        case 9 :
        {
            return "Charge Indicator";
        }
        case 10 :
        {
            return "Preheat Indicator";
        }
        case 11 :
        {
            return "High Boost Pressure";
        }
        case 12 :
        {
            return "Rev Limit Exceeded";
        }
        case 13 :
        {
            return "EGR System";
        }
        case 14 :
        {
            return "Throttle Position Sensor";
        }
        case 15 :
        {
            return "Emergency Stop";
        }
        default :
        {
            return "Reserved";
        }
    }
}//end function LOOKUP_ENGINE_STATUS_1

function LOOKUP_ENGINE_STATUS_2(value)
{
    switch (value)
    {
        case 0 :
        {
            return "Warning Level 1";
        }
        case 1 :
        {
            return "Warning Level 2";
        }
        case 2 :
        {
            return "Power Reduction";
        }
        case 3 :
        {
            return "Maintenance Needed";
        }
        case 4 :
        {
            return "Engine Comm Error";
        }
        case 5 :
        {
            return "Sub or Secondary Throttle";
        }
        case 6 :
        {
            return "Neutral Start Protect";
        }
        case 7 :
        {
            return "Engine Shutting Down";
        }
        default :
        {
            return "Reserved";
        }
    }
}//end function LOOKUP_ENGINE_STATUS_2

function LOOKUP_ENGINE_INSTANCE(value)
{
    switch (value)
    {
        case 0 :
        {
            str = "Single Engine or Dual Engine Port";
            break;
        }
        case 1 :
        {
            str = "Dual Engine Starboard";
            break;
        }
        default :
        {
            str = "Reserved";
            break;
        }
    }
}//end function LOOKUP_ENGINE_INSTANCE

//------------------------------------------------------------------------------------------------------------------------------------------//
//                                                     END LOOKUP FUNCTIONS                                                                 //
//------------------------------------------------------------------------------------------------------------------------------------------//

//------------------------------------------------------------------------------------------------------------------------------------------//
//                                                  Single Frame Packet Functions                                                           //
//------------------------------------------------------------------------------------------------------------------------------------------//

function Bus_Phase(decoder_items) // 65001-65006
{
    var str = "";
    switch (data_nb)
    {
        case 0 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 1 :
        {
            multi_byte_value += (hex_value<<8);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Line-Line AC RMS Voltage : " + (multi_byte_value.toString().replace(/(\d)(?=(\d{3})+\b)/g,'$1 ')) + " V");
            ScanaStudio.dec_item_add_content((multi_byte_value.toString().replace(/(\d)(?=(\d{3})+\b)/g,'$1 ')) + " V");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Data",
                ("Line-Line Voltage : " + (multi_byte_value.toString().replace(/(\d)(?=(\d{3})+\b)/g,'$1 ')) + " V"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 2 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 3 :
        {
            multi_byte_value += (hex_value<<8);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Line-Neutral AC RMS Voltage : " + (multi_byte_value.toString().replace(/(\d)(?=(\d{3})+\b)/g,'$1 ')) + " V");
            ScanaStudio.dec_item_add_content((multi_byte_value.toString().replace(/(\d)(?=(\d{3})+\b)/g,'$1 ')) + " V");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Data",
                ("Line-Neutral Voltage : " + (multi_byte_value.toString().replace(/(\d)(?=(\d{3})+\b)/g,'$1 ')) + " V"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 4 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 5 :
        {
            multi_byte_value += (hex_value<<8);
            multi_byte_value = Math.floor(multi_byte_value/128);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("AC Frequency : " + multi_byte_value + "Hz");
            ScanaStudio.dec_item_add_content(multi_byte_value + " kWh");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Data",
                ("AC Frequency : " + multi_byte_value + "Hz"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        default :
        {
            packet_title = "Filled Data";
            if (hex_value == 255)
            {
                item_content = "Filled with 0xFF";
            }
            else
            {
                item_content = "0x" + pad(hex_value.toString(16),2) + ", should be 0xFF";
                types_title = ScanaStudio.PacketColors.Error.Title;
                types_content = ScanaStudio.PacketColors.Error.Content;
            }
            break;
        }
    }//end switch (data_nb)
}//end function Bus_Phase_C

function Utility_Total_AC_Energy(decoder_items) //65005/65018
{
    var str = "";
    switch (data_nb)
    {
        case 0 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 1 :
        {
            multi_byte_value += (hex_value<<8);
            skip_item = true;
            break;
        }
        case 2 :
        {
            multi_byte_value += (hex_value<<16);
            skip_item = true;
            break;
        }
        case 3 :
        {
            multi_byte_value += hex_value*Math.pow(2,24);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Total Energy Export : " + (multi_byte_value.toString().replace(/(\d)(?=(\d{3})+\b)/g,'$1 ')) + " kWh");
            ScanaStudio.dec_item_add_content((multi_byte_value.toString().replace(/(\d)(?=(\d{3})+\b)/g,'$1 ')) + " kWh");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Total Energy",
                ("Export : " + (multi_byte_value.toString().replace(/(\d)(?=(\d{3})+\b)/g,'$1 ')) + " kWh"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 4 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 5 :
        {
            multi_byte_value += (hex_value<<8);
            skip_item = true;
            break;
        }
        case 6 :
        {
            multi_byte_value += (hex_value<<16);
            skip_item = true;
            break;
        }
        case 7 :
        {
            multi_byte_value += hex_value*Math.pow(2,24);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Total Energy Import : " + (multi_byte_value.toString().replace(/(\d)(?=(\d{3})+\b)/g,'$1 ')) + " kWh");
            ScanaStudio.dec_item_add_content((multi_byte_value.toString().replace(/(\d)(?=(\d{3})+\b)/g,'$1 ')) + " kWh");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Total Energy",
                ("Import : " + (multi_byte_value.toString().replace(/(\d)(?=(\d{3})+\b)/g,'$1 ')) + " kWh"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        default :
        {
            packet_title = "Filled Data";
            if (hex_value == 255)
            {
                item_content = "Filled with 0xFF";
            }
            else
            {
                item_content = "0x" + pad(hex_value.toString(16),2) + ", should be 0xFF";
                types_title = ScanaStudio.PacketColors.Error.Title;
                types_content = ScanaStudio.PacketColors.Error.Content;
            }
            break;
        }
    }//end switch (data_nb)
}//end function Utility_Total_AC_Energy

function Utility_Phase_AC_Reactive_Power(decoder_items) // 65006/65009/65012/65015/65019/65022/65025/65028
{
    var str = "";
    switch (data_nb)
    {
        case 0 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 1 :
        {
            multi_byte_value += (hex_value<<8);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Reactive Power : " + (multi_byte_value.toString().replace(/(\d)(?=(\d{3})+\b)/g,'$1 ')) + " VAR");
            ScanaStudio.dec_item_add_content((multi_byte_value.toString().replace(/(\d)(?=(\d{3})+\b)/g,'$1 ')) + " VAR");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Data",
                ("Reactive Power : " + (multi_byte_value.toString().replace(/(\d)(?=(\d{3})+\b)/g,'$1 ')) + " VAR"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 2 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 3 :
        {
            multi_byte_value += (hex_value<<8);
            multi_byte_value = multi_byte_value/16384;
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Power Factor : " + ((multi_byte_value.toFixed(6)).toString().replace(/(\d)(?=(\d{3})+\b)/g,'$1 ')));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Data",
                ("Power Factor : " + ((multi_byte_value.toFixed(6)).toString().replace(/(\d)(?=(\d{3})+\b)/g,'$1 '))),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 4 :
        {
            var power_factor_lagging = (hex_value>>6);
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/8*2;
            switch (power_factor_lagging)
            {
                case 0 :
                {
                    str = "Leading";
                    break;
                }
                case 1 :
                {
                    str = "Lagging";
                    break;
                }
                case 2 :
                {
                    str = "Error";
                    break;
                }
                default :
                {
                    str = "Reserved";
                    break;
                }
            }
            ScanaStudio.dec_item_new(decoder_items.channel_index,decoder_items.start_sample_index, end_item);
            ScanaStudio.dec_item_add_content("Power Factor Lagging : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                end_item,
                "Data",
                ("Power Factor Lagging : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            ScanaStudio.dec_item_new(decoder_items.channel_index, end_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Filled Data");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                end_item,
                decoder_items.end_sample_index,
                "Filled Data",
                ("Filled Data"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        default :
        {
            packet_title = "Filled Data";
            if (hex_value == 255)
            {
                item_content = "Filled with 0xFF";
            }
            else
            {
                item_content = "0x" + pad(hex_value.toString(16),2) + ", should be 0xFF";
                types_title = ScanaStudio.PacketColors.Error.Title;
                types_content = ScanaStudio.PacketColors.Error.Content;
            }
            break;
        }
    }//end switch (data_nb)
}//end function Utility_Phase_C_AC_Reactive_Power

function Utility_Phase_AC_Power(decoder_items) // 65007/65010/65013/65016/65022/65025/65028
{
    var str = "";
    switch (data_nb)
    {
        case 0 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 1 :
        {
            multi_byte_value += (hex_value<<8);
            skip_item = true;
            break;
        }
        case 2 :
        {
            multi_byte_value += (hex_value<<16);
            skip_item = true;
            break;
        }
        case 3 :
        {
            multi_byte_value += hex_value*Math.pow(2,24);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Real Power : " + (multi_byte_value.toString().replace(/(\d)(?=(\d{3})+\b)/g,'$1 ')) + " W");
            ScanaStudio.dec_item_add_content((multi_byte_value.toString().replace(/(\d)(?=(\d{3})+\b)/g,'$1 ')) + " W");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Real Power",
                ((multi_byte_value.toString().replace(/(\d)(?=(\d{3})+\b)/g,'$1 ')) + " W"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 4 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 5 :
        {
            multi_byte_value += (hex_value<<8);
            skip_item = true;
            break;
        }
        case 6 :
        {
            multi_byte_value += (hex_value<<16);
            skip_item = true;
            break;
        }
        case 7 :
        {
            multi_byte_value += hex_value*Math.pow(2,24);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Apparent Power : " + (multi_byte_value.toString().replace(/(\d)(?=(\d{3})+\b)/g,'$1 ')) + " VA");
            ScanaStudio.dec_item_add_content((multi_byte_value.toString().replace(/(\d)(?=(\d{3})+\b)/g,'$1 ')) + " VA");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Apparent Power",
                ((multi_byte_value.toString().replace(/(\d)(?=(\d{3})+\b)/g,'$1 ')) + " VA"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        default :
        {
            packet_title = "Filled Data";
            if (hex_value == 255)
            {
                item_content = "Filled with 0xFF";
            }
            else
            {
                item_content = "0x" + pad(hex_value.toString(16),2) + ", should be 0xFF";
                types_title = ScanaStudio.PacketColors.Error.Title;
                types_content = ScanaStudio.PacketColors.Error.Content;
            }
            break;
        }
    }//end switch (data_nb)
}//end function Utility_Phase_C_AC_Power

function Utility_Phase_Basic_AC_Quantities(decoder_items) // 65008/65011/65014/65017/65020/65023/65026/65029
{
    var str = "";
    switch (data_nb)
    {
        case 0 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 1 :
        {
            multi_byte_value += (hex_value<<8);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Line-Line AC RMS Voltage : " + (multi_byte_value.toString().replace(/(\d)(?=(\d{3})+\b)/g,'$1 ')) + " V");
            ScanaStudio.dec_item_add_content((multi_byte_value.toString().replace(/(\d)(?=(\d{3})+\b)/g,'$1 ')) + " V");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Data",
                ("Line-Line Voltage : " + (multi_byte_value.toString().replace(/(\d)(?=(\d{3})+\b)/g,'$1 ')) + " V"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 2 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 3 :
        {
            multi_byte_value += (hex_value<<8);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Line-Neutral AC RMS Voltage : " + (multi_byte_value.toString().replace(/(\d)(?=(\d{3})+\b)/g,'$1 ')) + " V");
            ScanaStudio.dec_item_add_content((multi_byte_value.toString().replace(/(\d)(?=(\d{3})+\b)/g,'$1 ')) + " V");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Data",
                ("Line-Neutral Voltage : " + (multi_byte_value.toString().replace(/(\d)(?=(\d{3})+\b)/g,'$1 ')) + " V"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 4 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 5 :
        {
            multi_byte_value += (hex_value<<8);
            multi_byte_value = Math.floor(multi_byte_value/128);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("AC Frequency : " + multi_byte_value + " Hz");
            ScanaStudio.dec_item_add_content(multi_byte_value + " Hz");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Data",
                ("AC Frequency : " + multi_byte_value + " Hz"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 6 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 7 :
        {
            multi_byte_value += (hex_value<<8);
            multi_byte_value = Math.floor(multi_byte_value/128);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("AC RMS Current : " + multi_byte_value + " A");
            ScanaStudio.dec_item_add_content(multi_byte_value + " A");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Data",
                ("AC RMS Current : " + multi_byte_value + " A"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        default :
        {
            packet_title = "Filled Data";
            if (hex_value == 255)
            {
                item_content = "Filled with 0xFF";
            }
            else
            {
                item_content = "0x" + pad(hex_value.toString(16),2) + ", should be 0xFF";
                types_title = ScanaStudio.PacketColors.Error.Title;
                types_content = ScanaStudio.PacketColors.Error.Content;
            }
            break;
        }
    }//end switch (data_nb)
}//end function Utility_Phase_C_Basic_AC_Quantities

function System_Time(decoder_items) //126992
{
    var str = "";
    switch (data_nb)
    {
        case 0 :
        {
            item_content = "SID : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 1 :
        {
            var source = (hex_value>>4);
            var reserved = hex_value&0xF;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/2;
            switch (source)
            {
                case 0 :
                {
                    str = "GPS";
                    break;
                }
                case 1 :
                {
                    str = "GLONASS";
                    break;
                }
                case 2 :
                {
                    str = "Radio Station";
                    break;
                }
                case 3 :
                {
                    str = "Local Cesium";
                    break;
                }
                case 4 :
                {
                    str = "Local Rubidium clock";
                    break;
                }
                case 5 :
                {
                    str = "Local Crystal clock";
                    break;
                }
                default :
                {
                    str = "Unknown";
                    break;
                }
            }
            ScanaStudio.dec_item_new(decoder_items.channel_index,decoder_items.start_sample_index,end_item);
            ScanaStudio.dec_item_add_content("Source : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                end_item,
                "Data",
                ("Source : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            ScanaStudio.dec_item_new(decoder_items.channel_index,end_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Reserved : 0x" + pad(reserved.toString(16),1));
            ScanaStudio.dec_item_add_content("0x" + pad(reserved.toString(16),1));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                end_item,
                decoder_items.end_sample_index,
                "Data",
                ("Reserved : 0x" + pad(reserved.toString(16),1)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 2 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 3 :
        {
            multi_byte_value += (hex_value<<8);
            system_time.setTime((multi_byte_value)*1000*24*3600);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Date : " + system_time.getMonth() + "/" + system_time.getDate() + "/" + system_time.getFullYear() + " (month/day/year)");
            ScanaStudio.dec_item_add_content("Date : " + system_time.getMonth() + "/" + system_time.getDate() + "/" + system_time.getFullYear());
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Data",
                ("Date : " + system_time.getMonth() + "/" + system_time.getDate() + "/" + system_time.getFullYear() + " (m/d/y)"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 4 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 5 :
        {
            multi_byte_value += (hex_value<<8);
            skip_item = true;
            break;
        }
        case 6 :
        {
            multi_byte_value += (hex_value<<16);
            skip_item = true;
            break;
        }
        case 7 :
        {
            multi_byte_value += hex_value*Math.pow(2,24);
            system_time.setTime((multi_byte_value/10)-(3600*1000)); // the Date object is initialize the 1 january, 1970 at 1am
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Time : " + system_time.getHours() + "h" + system_time.getMinutes() + "min" + system_time.getSeconds() + "sec");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Data",
                ("Time : " + system_time.getHours() + "h" + system_time.getMinutes() + "min" + system_time.getSeconds() + "sec"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        default :
        {
            packet_title = "Filled Data";
            if (hex_value == 255)
            {
                item_content = "Filled with 0xFF";
            }
            else
            {
                item_content = "0x" + pad(hex_value.toString(16),2) + ", should be 0xFF";
                types_title = ScanaStudio.PacketColors.Error.Title;
                types_content = ScanaStudio.PacketColors.Error.Content;
            }
            break;
        }
    }//end switch (data_nb)
}//end function System_Time

function Heartbeat(decoder_items) //126993
{
    var str = "";
    switch (data_nb)
    {
        case 0 :
        {
            multi_byte_value = hex_value;
            start_item = decoder_items.start_sample_index;
            skip_item = true;
            break;
        }
        case 1 :
        {
            multi_byte_value += (hex_value<<8);
            multi_byte_value = multi_byte_value*0.01;
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Data transmit offset : " + multi_byte_value.toFixed(2) + " s");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(2) + " s");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Data",
                ("Data transmit offset : " + multi_byte_value.toFixed(2) + " s"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 2 :
        {
            item_content = "Sequence Counter : " + hex_value;
            break;
        }
        case 3 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 4 :
        {
            multi_byte_value += (hex_value<<8);
            skip_item = true;
            break;
        }
        case 5 :
        {
            multi_byte_value += (hex_value<<16);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Reserved : 0x" + pad(multi_byte_value.toString(16),6));
            ScanaStudio.dec_item_add_content("Reserved");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Data",
                ("Reserved : 0x" + pad(multi_byte_value.toString(16),6)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        default :
        {
            packet_title = "Filled Data";
            if (hex_value == 255)
            {
                item_content = "Filled with 0xFF";
            }
            else
            {
                item_content = "0x" + pad(hex_value.toString(16),2) + ", should be 0xFF";
                types_title = ScanaStudio.PacketColors.Error.Title;
                types_content = ScanaStudio.PacketColors.Error.Content;
            }
            break;
        }
    }//end switch (data_nb)
}//end function Heartbeat

function Rudder(decoder_items) //127245
{
    var str = "";
    switch (data_nb)
    {
        case 0 :
        {
            item_content = "Instance : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 1 :
        {
            var direction_order = (hex_value>>6);
            var reserved = hex_value&0x3F;
            var end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/8*2;
            ScanaStudio.dec_item_new(decoder_items.channel_index,decoder_items.start_sample_index,end_item);
            ScanaStudio.dec_item_add_content("Direction Order : 0x" + pad(direction_order.toString(16),1));
            ScanaStudio.dec_item_add_content("0x" + pad(direction_order.toString(16),1));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                end_item,
                "Data",
                ("Direction Order : 0x" + pad(direction_order.toString(16),1)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            ScanaStudio.dec_item_new(decoder_items.channel_index,end_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Reserved : 0x" + pad(reserved.toString(16),2));
            ScanaStudio.dec_item_add_content("Reserved");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                end_item,
                decoder_items.end_sample_index,
                "Data",
                ("Reserved : 0x" + pad(reserved.toString(16),2)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 2 :
        {
            multi_byte_value = hex_value;
            start_item = decoder_items.start_sample_index;
            skip_item = true;
            break;
        }
        case 3 :
        {
            multi_byte_value += (hex_value<<8);
            multi_byte_value = multi_byte_value/10000;
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Angle Order : " + multi_byte_value.toFixed(4) + " rad");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(4) + " rad");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Data",
                ("Angle Order : " + multi_byte_value.toFixed(4) + " rad"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 4 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 5 :
        {
            multi_byte_value += (hex_value<<8);
            multi_byte_value = multi_byte_value/10000;
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Position : " + multi_byte_value.toFixed(4) + " rad");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(4) + " rad");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Data",
                ("Position : " + multi_byte_value.toFixed(4) + " rad"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        default :
        {
            packet_title = "Filled Data";
            if (hex_value == 255)
            {
                item_content = "Filled with 0xFF";
            }
            else
            {
                item_content = "0x" + pad(hex_value.toString(16),2) + ", should be 0xFF";
                types_title = ScanaStudio.PacketColors.Error.Title;
                types_content = ScanaStudio.PacketColors.Error.Content;
            }
            break;
        }
    }//end switch (data_nb)
}//end function Rudder

function Vessel_Heading(decoder_items) //127250
{
    var str = "";
    switch (data_nb)
    {
        case 0 :
        {
            item_content = "SID : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 1 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 2 :
        {
            multi_byte_value += (hex_value<<8);
            multi_byte_value = multi_byte_value/10000;
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Heading : " + multi_byte_value.toFixed(4) + " rad");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(4) + " rad");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Data",
                ("Heading : " + multi_byte_value.toFixed(4) + " rad"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 3 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 4 :
        {
            multi_byte_value += (hex_value<<8);
            multi_byte_value = multi_byte_value/10000;
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Deviation : " + multi_byte_value.toFixed(4) + " rad");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(4) + " rad");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Data",
                ("Deviation : " + multi_byte_value.toFixed(4) + " rad"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 5 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 6 :
        {
            multi_byte_value += (hex_value<<8);
            multi_byte_value = multi_byte_value/10000;
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Variation : " + multi_byte_value.toFixed(4) + " rad");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(4) + " rad");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Data",
                ("Variation : " + multi_byte_value.toFixed(4) + " rad"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 7 :
        {
            var reference = (hex_value>>6);
            var reserved = hex_value&0x3F;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/4;
            str = LOOKUP_DIRECTION_REFERENCE(reference);
            ScanaStudio.dec_item_new(decoder_items.channel_index,decoder_items.start_sample_index,end_item);
            ScanaStudio.dec_item_add_content("Reference : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                end_item,
                "Data",
                ("Reference : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            ScanaStudio.dec_item_new(decoder_items.channel_index,end_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Reserved : 0x" + pad(reserved.toString(16),2));
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                end_item,
                decoder_items.end_sample_index,
                "Data",
                ("Reserved : 0x" + pad(reserved.toString(16),2)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        default :
        {
            packet_title = "Filled Data";
            if (hex_value == 255)
            {
                item_content = "Filled with 0xFF";
            }
            else
            {
                item_content = "0x" + pad(hex_value.toString(16),2) + ", should be 0xFF";
                types_title = ScanaStudio.PacketColors.Error.Title;
                types_content = ScanaStudio.PacketColors.Error.Content;
            }
            break;
        }
    }//end switch (data_nb)
}//end function Vessel_Heading

function Rate_of_Turn(decoder_items) //127251
{
    var str = "";
    switch (data_nb)
    {
        case 0 :
        {
            item_content = "SID : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 1 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 2 :
        {
            multi_byte_value += (hex_value<<8);
            skip_item = true;
            break;
        }
        case 3 :
        {
            multi_byte_value += (hex_value<<16);
            skip_item = true;
            break;
        }
        case 4 :
        {
            multi_byte_value += hex_value*Math.pow(2,24);
            multi_byte_value = multi_byte_value*(Math.pow(10,-6)/32);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Rate : " + multi_byte_value.toFixed(8) + " rad/s");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(8) + " rad/s");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Data",
                ("Rate : " + multi_byte_value.toFixed(8) + " rad/s"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        default :
        {
            packet_title = "Filled Data";
            if (hex_value == 255)
            {
                item_content = "Filled with 0xFF";
            }
            else
            {
                item_content = "0x" + pad(hex_value.toString(16),2) + ", should be 0xFF";
                types_title = ScanaStudio.PacketColors.Error.Title;
                types_content = ScanaStudio.PacketColors.Error.Content;
            }
            break;
        }
    }//end switch (data_nb)
}//end function Rate_of_Turn

function Attitude(decoder_items) //127257
{
    var str = "";
    switch (data_nb)
    {
        case 0 :
        {
            item_content = "SID : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 1 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 2 :
        {
            multi_byte_value += (hex_value<<8);
            multi_byte_value = multi_byte_value/10000;
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Yaw : " + multi_byte_value.toFixed(4) + " rad");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(4) + " rad");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Data",
                ("Yaw : " + multi_byte_value.toFixed(4) + " rad"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 3 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 4 :
        {
            multi_byte_value += (hex_value<<8);
            multi_byte_value = multi_byte_value/10000;
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Pitch : " + multi_byte_value.toFixed(4) + " rad");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(4) + " rad");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Data",
                ("Pitch : " + multi_byte_value.toFixed(4) + " rad"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 5 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 6 :
        {
            multi_byte_value += (hex_value<<8);
            multi_byte_value = multi_byte_value/10000;
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Roll : " + multi_byte_value.toFixed(4) + " rad");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(4) + " rad");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Data",
                ("Roll : " + multi_byte_value.toFixed(4) + " rad"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        default :
        {
            packet_title = "Filled Data";
            if (hex_value == 255)
            {
                item_content = "Filled with 0xFF";
            }
            else
            {
                item_content = "0x" + pad(hex_value.toString(16),2) + ", should be 0xFF";
                types_title = ScanaStudio.PacketColors.Error.Title;
                types_content = ScanaStudio.PacketColors.Error.Content;
            }
            break;
        }
    }//end switch (data_nb)
}//end function Attitude

function Magnetic_Variation(decoder_items) //127258
{
    var str = "";
    switch (data_nb)
    {
        case 0 :
        {
            item_content = "SID : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 1 :
        {
            var source = (hex_value>>4);
            var reserved = hex_value&0xF;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/2;
            switch (source)
            {
                case 0 :
                {
                    str = "Manual";
                    break;
                }
                case 1 :
                {
                    str = "Automatic Chart";
                    break;
                }
                case 2 :
                {
                    str = "Automatic Table";
                    break;
                }
                case 3 :
                {
                    str = "Automatic Calculation";
                    break;
                }
                case 4 :
                {
                    str = "WMM 2000";
                    break;
                }
                case 5 :
                {
                    str = "WMM 2005";
                    break;
                }
                case 6 :
                {
                    str = "WMM 2010";
                    break;
                }
                case 7 :
                {
                    str = "WMM 2015";
                    break;
                }
                case 8 :
                {
                    str = "WMM 2020";
                    break;
                }
                default :
                {
                    str = "Unknown";
                    break;
                }
            }
            ScanaStudio.dec_item_new(decoder_items.channel_index,decoder_items.start_sample_index,end_item);
            ScanaStudio.dec_item_add_content("Source : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                end_item,
                "Data",
                ("Source : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            ScanaStudio.dec_item_new(decoder_items.channel_index,end_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Reserved : 0x" + pad(reserved.toString(16),1));
            ScanaStudio.dec_item_add_content("0x" + pad(reserved.toString(16),1));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                end_item,
                decoder_items.end_sample_index,
                "Data",
                ("Reserved : 0x" + pad(reserved.toString(16),1)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 2 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 3 :
        {
            multi_byte_value = hex_value;
            system_time.setTime((multi_byte_value)*1000*24*3600);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Age of service : " + system_time.getMonth() + "/" + system_time.getDate() + "/" + system_time.getFullYear() + " (month/day/year)");
            ScanaStudio.dec_item_add_content("Age of service : " + system_time.getMonth() + "/" + system_time.getDate() + "/" + system_time.getFullYear());
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Age of service",
                (system_time.getMonth() + "/" + system_time.getDate() + "/" + system_time.getFullYear() + " (m/d/y)"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 4 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 5 :
        {
            multi_byte_value = hex_value;
            multi_byte_value = multi_byte_value/10000;
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Variation : " + multi_byte_value.toFixed(4) + " rad");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(4) + " rad");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Data",
                ("Variation : " + multi_byte_value.toFixed(4) + " rad"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        default :
        {
            packet_title = "Filled Data";
            if (hex_value == 255)
            {
                item_content = "Filled with 0xFF";
            }
            else
            {
                item_content = "0x" + pad(hex_value.toString(16),2) + ", should be 0xFF";
                types_title = ScanaStudio.PacketColors.Error.Title;
                types_content = ScanaStudio.PacketColors.Error.Content;
            }
            break;
        }
    }//end switch (data_nb)
}//end function Magnetic_Variation

function Engine_parameter_Rapid_Update(decoder_items) //127488
{
    var str = "";
    switch (data_nb)
    {
        case 0 :
        {
            switch (hex_value)
            {
                case 0 :
                {
                    str = "Single Engine or Dual Engine Port";
                    break;
                }
                case 1 :
                {
                    str = "Dual Engine Starboard";
                    break;
                }
            }
            item_content = "Instance : " + str;
            break;
        }
        case 1 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 2 :
        {
            multi_byte_value += (hex_value<<8);
            multi_byte_value = multi_byte_value*0.25;
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Speed : " + multi_byte_value.toFixed(2) + " rpm");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(2) + " rpm");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Data",
                ("Speed : " + multi_byte_value.toFixed(2) + " rpm"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
        }
        case 3 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 4 :
        {
            multi_byte_value += (hex_value<<8);
            multi_byte_value = multi_byte_value*0.25;
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Boost Pressure : " + multi_byte_value.toFixed(2) + " hPa");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(2) + " hPa");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Data",
                ("Boost Pressure : " + multi_byte_value.toFixed(2) + " hPa"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 5 :
        {
            /*Signed 8 bit integer (LSB)
            Range ±124%
            Resolution 1%
            */
            var tilt_trim = ((hex_value<<24) >>24); // Convert Uint to Int (found here : https://stackoverflow.com/questions/14890994/javascript-c-style-type-cast-from-signed-to-unsigned)
            ScanaStudio.dec_item_new(decoder_items.channel_index,decoder_items.start_sample_index,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Tilt/Trim : " + tilt_trim + "%");
            ScanaStudio.dec_item_add_content(hex_value);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                decoder_items.end_sample_index,
                "Data",
                ("Tilt/Trim : " + tilt_trim + "%"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        default :
        {
            packet_title = "Filled Data";
            if (hex_value == 255)
            {
                item_content = "Filled with 0xFF";
            }
            else
            {
                item_content = "0x" + pad(hex_value.toString(16),2) + ", should be 0xFF";
                types_title = ScanaStudio.PacketColors.Error.Title;
                types_content = ScanaStudio.PacketColors.Error.Content;
            }
            break;
        }
    }//end switch (data_nb)
}//end function Engine_parameter_Rapid_Update

function Transmission_Parameters_Dynamic(decoder_items) //127493
{
    var str = "";
    switch (data_nb)
    {
        case 0 :
        {
            switch (hex_value)
            {
                case 0 :
                {
                    str = "Single Engine or Dual Engine Port";
                    break;
                }
                case 1 :
                {
                    str = "Dual Engine Starboard";
                    break;
                }
                default :
                {
                    str = "Reserved";
                }
            }
            item_content = "Instance : " + str;
            break;
        }
        case 1 :
        {
            var transmission_gear = (hex_value>>6);
            var reserved = hex_value&0x3F;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/4;
            switch (transmission_gear)
            {
                case 0 :
                {
                    str = "Forward";
                    break;
                }
                case 1 :
                {
                    str = "Neutral";
                    break;
                }
                case 2 :
                {
                    str = "Reverse";
                    break;
                }
                default :
                {
                    str = "Reserved";
                }
            }
            ScanaStudio.dec_item_new(decoder_items.channel_index,decoder_items.start_sample_index,end_item);
            ScanaStudio.dec_item_add_content("Transmission Gear : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                end_item,
                "Data",
                ("Transmission Gear : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            ScanaStudio.dec_item_new(decoder_items.channel_index,end_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Reserved : 0x" + pad(reserved.toString(16),2));
            ScanaStudio.dec_item_add_content("0x" + pad(reserved.toString(16),2));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                end_item,
                decoder_items.end_sample_index,
                "Data",
                ("Reserved : 0x" + pad(reserved.toString(16),2)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 2 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = (hex_value);
            skip_item = true;
            break;
        }
        case 3 :
        {
            multi_byte_value += (hex_value<<8);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Oil pressure : " + (multi_byte_value.toString().replace(/(\d)(?=(\d{3})+\b)/g,'$1 ')) + " hPa");
            ScanaStudio.dec_item_add_content((multi_byte_value.toString().replace(/(\d)(?=(\d{3})+\b)/g,'$1 ')));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Data",
                ("Oil pressure : " + (multi_byte_value.toString().replace(/(\d)(?=(\d{3})+\b)/g,'$1 ')) + " hPa"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 4 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = (hex_value);
            skip_item = true;
            break;
        }
        case 5 :
        {
            multi_byte_value += (hex_value<<8);
            multi_byte_value = multi_byte_value/10;
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Oil temperature : " + multi_byte_value.toFixed(1) + " K");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(1));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Data",
                ("Oil temperature : " + multi_byte_value.toFixed(1) + " K"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 6 :
        {
            item_content = "Discrete Status : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 7 :
        {
            item_content = "Reserved : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        default :
        {
            packet_title = "Filled Data";
            if (hex_value == 255)
            {
                item_content = "Filled with 0xFF";
            }
            else
            {
                item_content = "0x" + pad(hex_value.toString(16),2) + ", should be 0xFF";
                types_title = ScanaStudio.PacketColors.Error.Title;
                types_content = ScanaStudio.PacketColors.Error.Content;
            }
            break;
        }
    }//end switch (data_nb)
}//end function Transmission_Parameters_Dynamic

// Usefull function for Binary_Switch_Bank_Status
function indicator (value)
{
    switch (value)
    {
        case 0 :
        {
            return "Off";
        }
        case 1 :
        {
            return "On";
        }
        case 2 :
        {
            return "Failed";
        }
        default :
        {
            return "Reserved";
        }
    }
}

function Binary_Switch_Bank_Status(decoder_items) //127501
{
    var str = "";
    switch (data_nb)
    {
        case 0 :
        {
            item_content = "Instance : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 1 :
        case 2 :
        case 3 :
        case 4 :
        case 5 :
        case 6 :
        case 7 :
        {
            quarter_length = (decoder_items.end_sample_index - decoder_items.start_sample_index)/4;
            for (a=0; a<4; a++)
            {
                var indic = ((hex_value)>>((3-a)*2));
                if (a == 3)
                {
                    var indic = hex_value&0x3;
                }
                str = indicator(indic);
                ScanaStudio.dec_item_new(decoder_items.channel_index,decoder_items.start_sample_index + quarter_length*a,decoder_items.start_sample_index + quarter_length*(a+1));
                ScanaStudio.dec_item_add_content("Indicator" + (1+a+(data_nb-1)*4) + " : " + str);
                ScanaStudio.dec_item_add_content(str);
                ScanaStudio.dec_item_end();
                // Packet View
                ScanaStudio.packet_view_add_packet(false,
                    decoder_items.channel_index,
                    decoder_items.start_sample_index + quarter_length*a,
                    decoder_items.start_sample_index + quarter_length*(a+1),
                    "Data",
                    ("Indicator" + (1+a+(data_nb-1)*4) + " : " + str),
                    ScanaStudio.PacketColors.Data.Title,
                    ScanaStudio.PacketColors.Data.Content);
            }
            skip_item = true;
            break;
        }
        default :
        {
            packet_title = "Filled Data";
            if (hex_value == 255)
            {
                item_content = "Filled with 0xFF";
            }
            else
            {
                item_content = "0x" + pad(hex_value.toString(16),2) + ", should be 0xFF";
                types_title = ScanaStudio.PacketColors.Error.Title;
                types_content = ScanaStudio.PacketColors.Error.Content;
            }
            break;
        }
    }//end switch (data_nb)
}//end function Binary_Switch_Bank_Status

function switch_look (value)
{
    switch (value)
    {
        case 0 :
        {
            return "Off";
        }
        case 1 :
        {
            return "On";
        }
        default :
        {
            return "Reserved";
        }
    }
}

function Switch_Bank_Control(decoder_items) //127502
{
    var str = "";
    switch (data_nb)
    {
        case 0 :
        {
            item_content = "Switch Bank Instance : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 1 :
        case 2 :
        case 3 :
        case 4 :
        case 5 :
        case 6 :
        case 7 :
        {
            quarter_length = (decoder_items.end_sample_index - decoder_items.start_sample_index)/4;
            for (a=0; a<4; a++)
            {
                var switchs = ((hex_value)>>((3-a)*2));
                if (a == 3)
                {
                    var indic = hex_value&0x3;
                }
                str = switch_look(switchs);
                ScanaStudio.dec_item_new(decoder_items.channel_index,decoder_items.start_sample_index + quarter_length*a,decoder_items.start_sample_index + quarter_length*(a+1));
                ScanaStudio.dec_item_add_content("Switch" + (1+a+(data_nb-1)*4) + " : " +  str);
                ScanaStudio.dec_item_add_content(str);
                ScanaStudio.dec_item_end();
                // Packet View
                ScanaStudio.packet_view_add_packet(false,
                    decoder_items.channel_index,
                    decoder_items.start_sample_index + quarter_length*a,
                    decoder_items.start_sample_index + quarter_length*(a+1),
                    "Data",
                    ("Switch" + (1+a+(data_nb-1)*4) + " : " +  str),
                    ScanaStudio.PacketColors.Data.Title,
                    ScanaStudio.PacketColors.Data.Content);
            }
            skip_item = true;
            break;
        }
        default :
        {
            packet_title = "Filled Data";
            if (hex_value == 255)
            {
                item_content = "Filled with 0xFF";
            }
            else
            {
                item_content = "0x" + pad(hex_value.toString(16),2) + ", should be 0xFF";
                types_title = ScanaStudio.PacketColors.Error.Title;
                types_content = ScanaStudio.PacketColors.Error.Content;
            }
            break;
        }
    }//end switch (data_nb)
}//end function Switch_Bank_Control

function Fluid_Level(decoder_items) //127505
{
    var str = "";
    switch (data_nb)
    {
        case 0 :
        {
            var instance = hex_value>>4;
            var type = hex_value&0xF;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/2;
            ScanaStudio.dec_item_new(decoder_items.channel_index,decoder_items.start_sample_index,end_item);
            ScanaStudio.dec_item_add_content("Instance : 0x" + pad(instance.toString(16),1));
            ScanaStudio.dec_item_add_content("0x" + pad(instance.toString(16),1));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                end_item,
                "Data",
                ("Instance : 0x" + pad(instance.toString(16),1)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            switch (type)
            {
                case 0 :
                {
                    str = "Fuel";
                    break;
                }
                case 1 :
                {
                    str = "Water";
                    break;
                }
                case 2 :
                {
                    str = "Gray water";
                    break;
                }
                case 3 :
                {
                    str = "Live well";
                    break;
                }
                case 4 :
                {
                    str = "Oil";
                    break;
                }
                case 5 :
                {
                    str = "Black water";
                    break;
                }
                default :
                {
                    str = "Reserved";
                }
            }
            ScanaStudio.dec_item_new(decoder_items.channel_index,end_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Type : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                end_item,
                decoder_items.end_sample_index,
                "Data",
                ("Type : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 1 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 2 :
        {
            multi_byte_value += (hex_value<<8);
            multi_byte_value = multi_byte_value*100/25000;
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Level : " + multi_byte_value.toFixed(3) + "%");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(3) + "%");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Data",
                ("Level : " + multi_byte_value.toFixed(3) + "%"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 3 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 4 :
        {
            multi_byte_value += (hex_value<<8);
            skip_item = true;
            break;
        }
        case 5 :
        {
            multi_byte_value += (hex_value<<16);
            skip_item = true;
            break;
        }
        case 6 :
        {
            multi_byte_value += hex_value*Math.pow(2,24);
            multi_byte_value = multi_byte_value*0.1;
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Capacity : " + ((multi_byte_value.toFixed(2)).toString().replace(/(\d)(?=(\d{3})+\b)/g,'$1 ')) + " L");
            ScanaStudio.dec_item_add_content(((multi_byte_value.toFixed(2)).toString().replace(/(\d)(?=(\d{3})+\b)/g,'$1 ')) + " L");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Data",
                ("Capacity : " + ((multi_byte_value.toFixed(2)).toString().replace(/(\d)(?=(\d{3})+\b)/g,'$1 ')) + " L"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 7 :
        {
            item_content = "Reserved 0x" + pad(hex_value.toString(16),2);
            break;
        }
        default :
        {
            packet_title = "Filled Data";
            if (hex_value == 255)
            {
                item_content = "Filled with 0xFF";
            }
            else
            {
                item_content = "0x" + pad(hex_value.toString(16),2) + ", should be 0xFF";
                types_title = ScanaStudio.PacketColors.Error.Title;
                types_content = ScanaStudio.PacketColors.Error.Content;
            }
            break;
        }
    }//end switch (data_nb)
}//end function Fluid_Level

function Charger_Status(decoder_items) //127507
{
    var str = "";
    switch (data_nb)
    {
        case 0 :
        {
            item_content = "Instance : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 1 :
        {
            item_content = "Batterry Instance : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 2 :
        {
            var operating_state = hex_value>>4;
            var charge_mode = hex_value&0xF;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/2;
            switch (operating_state)
            {
                case 0 :
                {
                    str = "Not charging";
                    break;
                }
                case 1 :
                {
                    str = "Bulk";
                    break;
                }
                case 2 :
                {
                    str = "Absorption";
                    break;
                }
                case 3 :
                {
                    str = "Overcharge";
                    break;
                }
                case 4 :
                {
                    str = "Equalise";
                    break;
                }
                case 5 :
                {
                    str = "Float";
                    break;
                }
                case 6 :
                {
                    str = "No Float";
                    break;
                }
                case 7 :
                {
                    str = "Constant";
                    break;
                }
                case 8 :
                {
                    str = "Disabled";
                    break;
                }
                case 9 :
                {
                    str = "Fault";
                    break;
                }
                default :
                {
                    str = "Reserved";
                }
            }
            ScanaStudio.dec_item_new(decoder_items.channel_index,decoder_items.start_sample_index,end_item);
            ScanaStudio.dec_item_add_content("Operating State : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                end_item,
                "Data",
                ("Operating State : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            switch (charge_mode)
            {
                case 0 :
                {
                    str = "Standalone mode";
                    break;
                }
                case 1 :
                {
                    str = "Primary mode";
                    break;
                }
                case 2 :
                {
                    str = "Secondary mode";
                    break;
                }
                case 3 :
                {
                    str = "Echo mode";
                    break;
                }
                default :
                {
                    str = "Reserved";
                }
            }
            ScanaStudio.dec_item_new(decoder_items.channel_index,end_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Charge Mode : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                end_item,
                decoder_items.end_sample_index,
                "Data",
                ("Charge Mode : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 3 :
        {
            var operating_state = (hex_value>>6);
            var equalization_pending = (hex_value>>4)&0x3;
            var reserved = hex_value&0xF;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/4;
            switch (operating_state)
            {
                case 0 :
                {
                    str = "Off";
                    break;
                }
                case 1 :
                {
                    str = "On";
                    break;
                }
                default :
                {
                    str = "Reserved";
                }
            }
            ScanaStudio.dec_item_new(decoder_items.channel_index,decoder_items.start_sample_index,end_item);
            ScanaStudio.dec_item_add_content("Operating State : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                end_item,
                "Data",
                ("Operating State : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            start_item = end_item;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/2;
            switch (equalization_pending)
            {
                case 0 :
                {
                    str = "Off";
                    break;
                }
                case 1 :
                {
                    str = "On";
                    break;
                }
                default :
                {
                    str = "Reserved";
                }
            }
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,end_item);
            ScanaStudio.dec_item_add_content("Equalization Pending : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                end_item,
                decoder_items.end_sample_index,
                "Data",
                ("Equalization Pending : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            ScanaStudio.dec_item_new(decoder_items.channel_index,end_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Reserved : 0x" + pad(reserved.toString(16),1));
            ScanaStudio.dec_item_add_content("Reserved");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                end_item,
                decoder_items.end_sample_index,
                "Data",
                ("Reserved : 0x" + pad(reserved.toString(16),1)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 4 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 5 :
        {
            multi_byte_value += (hex_value<<8);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Equalization Time Remaining : 0x" + pad(multi_byte_value.toString(16),4));
            ScanaStudio.dec_item_add_content("Reserved");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Equalization",
                ("Time Remaining : 0x" + pad(multi_byte_value.toString(16),4)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        default :
        {
            packet_title = "Filled Data";
            if (hex_value == 255)
            {
                item_content = "Filled with 0xFF";
            }
            else
            {
                item_content = "0x" + pad(hex_value.toString(16),2) + ", should be 0xFF";
                types_title = ScanaStudio.PacketColors.Error.Title;
                types_content = ScanaStudio.PacketColors.Error.Content;
            }
            break;
        }
    }//end switch (data_nb)
}//end function Charger_Status

function Battery_Status(decoder_items) //127508
{
    var str = "";
    switch (data_nb)
    {
        case 0 :
        {
            item_content = "Instance : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 1 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 2 :
        {
            multi_byte_value += (hex_value<<8);
            multi_byte_value = multi_byte_value*0.01;
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Voltage : " + multi_byte_value.toFixed(2) + "V");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(2) + "V");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Data",
                ("Voltage : " + multi_byte_value.toFixed(2) + "V"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 3 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 4 :
        {
            multi_byte_value += (hex_value<<8);
            multi_byte_value = multi_byte_value*0.1;
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Current : " + multi_byte_value.toFixed(2) + "A");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(2) + "A");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Data",
                ("Current : " + multi_byte_value.toFixed(2) + "V"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 5 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 6 :
        {
            multi_byte_value += (hex_value<<8);
            multi_byte_value = multi_byte_value*0.01;
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Temperature : " + multi_byte_value.toFixed(2) + " K");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(2) + " K");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Data",
                ("Temperature : " + multi_byte_value.toFixed(2) + " K"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 7 :
        {
            item_content = "SID : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        default :
        {
            packet_title = "Filled Data";
            if (hex_value == 255)
            {
                item_content = "Filled with 0xFF";
            }
            else
            {
                item_content = "0x" + pad(hex_value.toString(16),2) + ", should be 0xFF";
                types_title = ScanaStudio.PacketColors.Error.Title;
                types_content = ScanaStudio.PacketColors.Error.Content;
            }
            break;
        }
    }//end switch (data_nb)
}//end function Battery_Status

function Inverted_Status(decoder_items) //127509
{
    var str = "";
    switch (data_nb)
    {
        case 0 :
        {
            item_content = "Instance : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 1 :
        {
            item_content = "AC Instance : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 2 :
        {
            item_content = "DC Instance : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 3 :
        {
            var operating_state = hex_value>>4;
            var inverter = (hex_value>>2)&0x3;
            var reserved = hex_value&0x3;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/2;
            switch (operating_state)
            {
                case 0 :
                {
                    str = "Standby";
                }
                case 1 :
                {
                    str = "On";
                }
                default :
                {
                    str = "Reserved";
                }
            }
            ScanaStudio.dec_item_new(decoder_items.channel_index,decoder_items.start_sample_index,end_item);
            ScanaStudio.dec_item_add_content("Operating State : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                end_item,
                "Data",
                ("Operating State : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            start_item = end_item;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/4*3;
            switch (inverter)
            {
                case 0 :
                {
                    str = "Standby";
                }
                case 1 :
                {
                    str = "On";
                }
                default :
                {
                    str = "Reserved";
                }
            }
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,end_item);
            ScanaStudio.dec_item_add_content("Inverter : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                end_item,
                "Data",
                ("Inverter : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,end_item);
            ScanaStudio.dec_item_add_content("Reserved : 0x" + pad(reserved.toString(16),1));
            ScanaStudio.dec_item_add_content("Reserved");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                end_item,
                "Data",
                ("Reserved : 0x" + pad(reserved.toString(16),1)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        default :
        {
            packet_title = "Filled Data";
            if (hex_value == 255)
            {
                item_content = "Filled with 0xFF";
            }
            else
            {
                item_content = "0x" + pad(hex_value.toString(16),2) + ", should be 0xFF";
                types_title = ScanaStudio.PacketColors.Error.Title;
                types_content = ScanaStudio.PacketColors.Error.Content;
            }
            break;
        }
    }//end switch (data_nb)
}//end function Inverted_Status

function Leeway_Angle(decoder_items) //128000
{
    var str = "";
    switch (data_nb)
    {
        case 0 :
        {
            item_content = "SID : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 1 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 2 :
        {
            multi_byte_value += (hex_value<<8);
            multi_byte_value = multi_byte_value/10000;
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Leeway Angle : " + multi_byte_value.toFixed(4) + " rad");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(4) + " rad");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                end_item,
                "Data",
                ("Leeway Angle : " + multi_byte_value.toFixed(4) + " rad"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 3 :
        case 4 :
        case 5 :
        case 6 :
        case 7 :
        {
            item_content = "Reserved : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        default :
        {
            packet_title = "Filled Data";
            if (hex_value == 255)
            {
                item_content = "Filled with 0xFF";
            }
            else
            {
                item_content = "0x" + pad(hex_value.toString(16),2) + ", should be 0xFF";
                types_title = ScanaStudio.PacketColors.Error.Title;
                types_content = ScanaStudio.PacketColors.Error.Content;
            }
            break;
        }
    }//end switch (data_nb)
}//end function Leeway_Angle

function Speed(decoder_items) //128259
{
    var str = "";
    switch (data_nb)
    {
        case 0 :
        {
            item_content = "SID : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 1 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 2 :
        {
            multi_byte_value += (hex_value<<8);
            multi_byte_value = multi_byte_value*0.01;
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Speed Water Referenced : " + multi_byte_value.toFixed(2) + " m/s");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(2) + " m/s");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                end_item,
                "Data",
                ("Speed Water Ref : " + multi_byte_value.toFixed(2) + " m/s"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 3 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 4 :
        {
            multi_byte_value += (hex_value<<8);
            multi_byte_value = multi_byte_value*0.01;
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Speed Ground Referenced : " + multi_byte_value.toFixed(2) + " m/s");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(2) + " m/s");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                end_item,
                "Data",
                ("Speed Ground Ref : " + multi_byte_value.toFixed(2) + " m/s"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 5 :
        {
            switch (hex_value)
            {
                case 0 :
                {
                    str = "Paddle wheel";
                    break;
                }
                case 1 :
                {
                    str = "Pitot tube";
                    break;
                }
                case 2 :
                {
                    str = "Doppler";
                    break;
                }
                case 3 :
                {
                    str = "Correlation (ultra sound)";
                    break;
                }
                case 4 :
                {
                    str = "Electro Magnetic";
                    break;
                }
                default :
                {
                    str = "Reserved";
                }
            }
            ScanaStudio.dec_item_new(decoder_items.channel_index,decoder_items.start_sample_index, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Speed Water Reference Type : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                end_item,
                "Speed Water",
                ("Reference Type : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 6 :
        {
            var speed_direction = (hex_value>>4);
            multi_byte_value = hex_value&0xF;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/2;
            ScanaStudio.dec_item_new(decoder_items.channel_index,decoder_items.start_sample_index, end_item);
            ScanaStudio.dec_item_add_content("Speed Direction : 0x" + pad(speed_direction.toString(16),1));
            ScanaStudio.dec_item_add_content("0x" + pad(speed_direction.toString(16),1));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                end_item,
                "Data",
                ("Speed Direction : 0x" + pad(speed_direction.toString(16),1)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            start_item = end_item;
            skip_item = true;
            break;
        }
        case 7 :
        {
            multi_byte_value += (hex_value<<4);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Reserved : 0x" + pad(multi_byte_value.toString(16),3));
            ScanaStudio.dec_item_add_content("Reserved");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Data",
                ("Reserved : 0x" + pad(multi_byte_value.toString(16),3)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        default :
        {
            packet_title = "Filled Data";
            if (hex_value == 255)
            {
                item_content = "Filled with 0xFF";
            }
            else
            {
                item_content = "0x" + pad(hex_value.toString(16),2) + ", should be 0xFF";
                types_title = ScanaStudio.PacketColors.Error.Title;
                types_content = ScanaStudio.PacketColors.Error.Content;
            }
            break;
        }
    }//end switch (data_nb)
}//end function Speed

function Water_Depth(decoder_items) //128267
{
    var str = "";
    switch (data_nb)
    {
        case 0 :
        {
            item_content = "SID : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 1 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 2 :
        {
            multi_byte_value += (hex_value<<8);
            skip_item = true;
            break;
        }
        case 3 :
        {
            multi_byte_value += (hex_value<<16);
            skip_item = true;
            break;
        }
        case 4 :
        {
            multi_byte_value += hex_value*Math.pow(2,24);
            multi_byte_value = multi_byte_value*0.01;
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Depth : " + ((multi_byte_value.toFixed(2)).toString().replace(/(\d)(?=(\d{3})+\b)/g,'$1 ')) + "m (Depth below transducer)");
            ScanaStudio.dec_item_add_content("Depth : " + ((multi_byte_value.toFixed(2)).toString().replace(/(\d)(?=(\d{3})+\b)/g,'$1 ')) + "m");
            ScanaStudio.dec_item_add_content(((multi_byte_value.toFixed(2)).toString().replace(/(\d)(?=(\d{3})+\b)/g,'$1 ')) + "m");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Data",
                ("Depth : " + ((multi_byte_value.toFixed(2)).toString().replace(/(\d)(?=(\d{3})+\b)/g,'$1 ')) + "m"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 5 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 6 :
        {
            multi_byte_value += (hex_value<<8);
            multi_byte_value = multi_byte_value*0.001;
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Offset : " + multi_byte_value.toFixed(3) + "m (Distance between transducer and surface (positive) or keel (negative))");
            ScanaStudio.dec_item_add_content("Offset : " + multi_byte_value.toFixed(3) + "m");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(3) + "m");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Data",
                ("Offset : " + multi_byte_value.toFixed(3) + "m"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 7 :
        {
            item_content = "Range : " + (hex_value*10) + "m";
            break;
        }
        default :
        {
            packet_title = "Filled Data";
            if (hex_value == 255)
            {
                item_content = "Filled with 0xFF";
            }
            else
            {
                item_content = "0x" + pad(hex_value.toString(16),2) + ", should be 0xFF";
                types_title = ScanaStudio.PacketColors.Error.Title;
                types_content = ScanaStudio.PacketColors.Error.Content;
            }
            break;
        }
    }//end switch (data_nb)
}//end function Water_Depth

function Position_Rapid_Update(decoder_items) //129025
{
    var str = "";
    switch (data_nb)
    {
        case 0 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 1 :
        {
            multi_byte_value += (hex_value<<8);
            skip_item = true;
            break;
        }
        case 2 :
        {
            multi_byte_value += (hex_value<<16);
            skip_item = true;
            break;
        }
        case 3 :
        {
            multi_byte_value += hex_value*Math.pow(2,24);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Latitude : 0x" + pad(multi_byte_value.toString(16),8));
            ScanaStudio.dec_item_add_content("0x" + pad(multi_byte_value.toString(16),8));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Data",
                ("Latitude : 0x" + pad(multi_byte_value.toString(16),8)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 4 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 5 :
        {
            multi_byte_value += (hex_value<<8);
            skip_item = true;
            break;
        }
        case 6 :
        {
            multi_byte_value += (hex_value<<16);
            skip_item = true;
            break;
        }
        case 7 :
        {
            multi_byte_value += hex_value*Math.pow(2,24);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Longitude : 0x" + pad(multi_byte_value.toString(16),8));
            ScanaStudio.dec_item_add_content("0x" + pad(multi_byte_value.toString(16),8));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Data",
                ("Longitude : 0x" + pad(multi_byte_value.toString(16),8)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        default :
        {
            packet_title = "Filled Data";
            if (hex_value == 255)
            {
                item_content = "Filled with 0xFF";
            }
            else
            {
                item_content = "0x" + pad(hex_value.toString(16),2) + ", should be 0xFF";
                types_title = ScanaStudio.PacketColors.Error.Title;
                types_content = ScanaStudio.PacketColors.Error.Content;
            }
            break;
        }
    }//end switch (data_nb)
}//end function Position_Rapid_Update

function COG_SOG_Rapid_Update(decoder_items) //129026
{
    var str = "";
    switch (data_nb)
    {
        case 0 :
        {
            item_content = "SID : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 1 :
        {
            var cog_reference = hex_value>>6;
            var reserved = hex_value&0x3F;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/4;
            str = LOOKUP_DIRECTION_REFERENCE(cog_reference);
            ScanaStudio.dec_item_new(decoder_items.channel_index,decoder_items.start_sample_index, end_item);
            ScanaStudio.dec_item_add_content("COG Reference : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.Start_sample_index,
                end_item,
                "Data",
                ("COG Reference : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            ScanaStudio.dec_item_new(decoder_items.channel_index,end_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Reserved : 0x" + pad(reserved.toString(16),2));
            ScanaStudio.dec_item_add_content("Reserved");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                end_item,
                decoder_items.end_sample_index,
                "Data",
                ("Reserved : 0x" + pad(reserved.toString(16),2)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 2 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 3 :
        {
            multi_byte_value += (hex_value<<8);
            multi_byte_value = (multi_byte_value/10000);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("COG : " + multi_byte_value.toFixed(5) + " rad");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(5) + " rad");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Data",
                ("COG : " + multi_byte_value.toFixed(5) + " rad"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 4 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 5 :
        {
            multi_byte_value += (hex_value<<8);
            multi_byte_value = (multi_byte_value*0.01);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("SOG : " + multi_byte_value.toFixed(2) + " m/s");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(2) + " m/s");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Data",
                ("SOG : " + multi_byte_value.toFixed(2) + " m/s"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 6 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 7 :
        {
            multi_byte_value += (hex_value<<8);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Reserved : 0x" + pad(multi_byte_value.toString(16),4));
            ScanaStudio.dec_item_add_content("Reserved");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Data",
                ("Reserved : 0x" + pad(multi_byte_value.toString(16),4)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        default :
        {
            packet_title = "Filled Data";
            if (hex_value == 255)
            {
                item_content = "Filled with 0xFF";
            }
            else
            {
                item_content = "0x" + pad(hex_value.toString(16),2) + ", should be 0xFF";
                types_title = ScanaStudio.PacketColors.Error.Title;
                types_content = ScanaStudio.PacketColors.Error.Content;
            }
            break;
        }
    }//end switch (data_nb)
}//end function COG_SOG_Rapid_Update

function Time_Date(decoder_items) //129033
{
    var str = "";
    switch (data_nb)
    {
        case 0 :
        {
            multi_byte_value = hex_value;
            start_item = decoder_items.start_sample_index;
            skip_item = true;
            break;
        }
        case 1 :
        {
            multi_byte_value += (hex_value<<8);
            system_time.setTime((multi_byte_value)*1000*24*3600);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Date : " + system_time.getMonth() + "/" + system_time.getDate() + "/" + system_time.getFullYear() + " (month/day/year)");
            ScanaStudio.dec_item_add_content("Date : " + system_time.getMonth() + "/" + system_time.getDate() + "/" + system_time.getFullYear());
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Data",
                ("Date : " + system_time.getMonth() + "/" + system_time.getDate() + "/" + system_time.getFullYear() + " (m/d/y)"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 2 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 3 :
        {
            multi_byte_value += (hex_value<<8);
            skip_item = true;
            break;
        }
        case 4 :
        {
            multi_byte_value += (hex_value<<16);
            skip_item = true;
            break;
        }
        case 5 :
        {
            multi_byte_value += hex_value*Math.pow(2,24);
            system_time.setTime((multi_byte_value/10)-(3600*1000)); // the Date object is initialize the 1 january, 1970 at 1am
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Time : " + system_time.getHours() + "h" + system_time.getMinutes() + "min" + system_time.getSeconds() + "sec");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Data",
                ("Time : " + system_time.getHours() + "h" + system_time.getMinutes() + "min" + system_time.getSeconds() + "sec"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 6 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 7 :
        {
            multi_byte_value += (hex_value<<8);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Local Offset : " + multi_byte_value + "min");
            ScanaStudio.dec_item_add_content(multi_byte_value + "min");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Data",
                ("Local Offset : " + multi_byte_value + "min"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        default :
        {
            packet_title = "Filled Data";
            if (hex_value == 255)
            {
                item_content = "Filled with 0xFF";
            }
            else
            {
                item_content = "0x" + pad(hex_value.toString(16),2) + ", should be 0xFF";
                types_title = ScanaStudio.PacketColors.Error.Title;
                types_content = ScanaStudio.PacketColors.Error.Content;
            }
            break;
        }
    }//end switch (data_nb)
}//end function Time_Date


function Cross_Track_Error(decoder_items) //129283
{
    var str = "";
    switch (data_nb)
    {
        case 0 :
        {
            item_content = "SID : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 1 :
        {
            var xte_mode = hex_value>>6;
            var reserved = (hex_value>>2)&0x3;
            var navigation_terminated = hex_value&0x3;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/2;
            switch(xte_mode)
            {
                case 0 :
                {
                    str = "Autonomous";
                    break;
                }
                case 1 :
                {
                    str = "Differential enhanced";
                    break;
                }
                case 2 :
                {
                    str = "Estimated";
                    break;
                }
                case 3 :
                {
                    str = "Simulator";
                    break;
                }
                case 4 :
                {
                    str = "Manual";
                    break;
                }
                default :
                {
                    str = "Reserved";
                    break;
                }
            }
            ScanaStudio.dec_item_new(decoder_items.channel_index,decoder_items.start_sample_index, end_item);
            ScanaStudio.dec_item_add_content("XTE mode : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                end_item,
                "Data",
                ("XTE mode : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            start_item = end_item;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/4*3;
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item, end_item);
            ScanaStudio.dec_item_add_content("Reserved : 0x" + pad(reserved.toString(16),2));
            ScanaStudio.dec_item_add_content("Reserved");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                end_item,
                "Data",
                ("Reserved : 0x" + pad(reserved.toString(16),2)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            switch(navigation_terminated)
            {
                case 0 :
                {
                    str = "No";
                    break;
                }
                case 1 :
                {
                    str = "Yes";
                    break;
                }
                case 10 :
                {
                    str = "Error";
                    break;
                }
                case 1 :
                {
                    str = "Unavailable";
                    break;
                }
                default :
                {
                    str = "Reserved";
                    break;
                }
            }
            ScanaStudio.dec_item_new(decoder_items.channel_index,end_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Navigation Terminated : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                end_item,
                decoder_items.end_sample_index,
                "Data",
                ("Navigation Terminated : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 2 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 3 :
        {
            multi_byte_value += (hex_value<<8);
            skip_item = true;
            break;
        }
        case 4 :
        {
            multi_byte_value += (hex_value<<16);
            skip_item = true;
            break;
        }
        case 5 :
        {
            multi_byte_value += hex_value*Math.pow(2,24);
            multi_byte_value = (multi_byte_value*0.01);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("XTE : " + (multi_byte_value.toString().replace(/(\d)(?=(\d{3})+\b)/g,'$1 ')) + "m");
            ScanaStudio.dec_item_add_content((multi_byte_value.toString().replace(/(\d)(?=(\d{3})+\b)/g,'$1 ')) + "m");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Data",
                ("XTE : " + (multi_byte_value.toString().replace(/(\d)(?=(\d{3})+\b)/g,'$1 ')) + " m/s"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 6 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 7 :
        {
            multi_byte_value += (hex_value<<8);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Reserved : 0x" + pad(multi_byte_value.toString(16),4));
            ScanaStudio.dec_item_add_content("Reserved");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Data",
                ("Reserved : 0x" + pad(multi_byte_value.toString(16),4)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        default :
        {
            packet_title = "Filled Data";
            if (hex_value == 255)
            {
                item_content = "Filled with 0xFF";
            }
            else
            {
                item_content = "0x" + pad(hex_value.toString(16),2) + ", should be 0xFF";
                types_title = ScanaStudio.PacketColors.Error.Title;
                types_content = ScanaStudio.PacketColors.Error.Content;
            }
            break;
        }
    }//end switch (data_nb)
}//end function Cross_Track_Error

function GNSS_DOPs(decoder_items) //129539
{
    var str = "";
    switch (data_nb)
    {
        case 0 :
        {
            item_content = "SID : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 1 :
        {
            var desired_mode = (hex_value>>5);
            var actual_mode = (hex_value>>2)&0x7;
            var reserved = hex_value&0x3;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/8*3;
            switch(desired_mode)
            {
                case 0 :
                {
                    str = "1D";
                    break;
                }
                case 1 :
                {
                    str = "2D";
                    break;
                }
                case 2 :
                {
                    str = "3D";
                    break;
                }
                case 3 :
                {
                    str = "Auto";
                    break;
                }
                default :
                {
                    str = "Reserved";
                    break;
                }
            }
            ScanaStudio.dec_item_new(decoder_items.channel_index,decoder_items.start_sample_index, end_item);
            ScanaStudio.dec_item_add_content("Desired Mode : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.Start_sample_index,
                end_item,
                "Data",
                ("Desired Mode : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            start_item = end_item;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/8*6;
            switch(actual_mode)
            {
                case 0 :
                {
                    str = "1D";
                    break;
                }
                case 1 :
                {
                    str = "2D";
                    break;
                }
                case 2 :
                {
                    str = "3D";
                    break;
                }
                case 3 :
                {
                    str = "Auto";
                    break;
                }
                default :
                {
                    str = "Reserved";
                    break;
                }
            }
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item, end_item);
            ScanaStudio.dec_item_add_content("Actual Mode : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                end_item,
                "Data",
                ("Actual Mode : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            ScanaStudio.dec_item_new(decoder_items.channel_index,end_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Reserved : 0x" + pad(reserved.toString(16),1));
            ScanaStudio.dec_item_add_content("Reserved");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                end_item,
                decoder_items.end_sample_index,
                "Data",
                ("Reserved : 0x" + pad(reserved.toString(16),1)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 2 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 3 :
        {
            multi_byte_value += (hex_value<<8);
            multi_byte_value = multi_byte_value*0.01;
            ScanaStudio.dec_item_new(decoder_items.channel_index,end_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("HDOP : " + multi_byte_value.toFixed(2) + " (Horizontal dilution of precision)");
            ScanaStudio.dec_item_add_content("HDOP : " + multi_byte_value.toFixed(2));
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(2));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                end_item,
                decoder_items.end_sample_index,
                "Data",
                ("HDOP : " + multi_byte_value.toFixed(2)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 4 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 5 :
        {
            multi_byte_value += (hex_value<<8);
            multi_byte_value = multi_byte_value*0.01;
            ScanaStudio.dec_item_new(decoder_items.channel_index,end_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("VDOP : " + multi_byte_value.toFixed(2) + " (Vertical dilution of precision)");
            ScanaStudio.dec_item_add_content("VDOP : " + multi_byte_value.toFixed(2));
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(2));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                end_item,
                decoder_items.end_sample_index,
                "Data",
                ("VDOP : " + multi_byte_value.toFixed(2)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 6 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 7 :
        {
            multi_byte_value += (hex_value<<8);
            multi_byte_value = multi_byte_value*0.01;
            ScanaStudio.dec_item_new(decoder_items.channel_index,end_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("TDOP : " + multi_byte_value.toFixed(2) + " (Time dilution of precision)");
            ScanaStudio.dec_item_add_content("TDOP : " + multi_byte_value.toFixed(2));
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(2));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                end_item,
                decoder_items.end_sample_index,
                "Data",
                ("TDOP : " + multi_byte_value.toFixed(2)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        default :
        {
            packet_title = "Filled Data";
            if (hex_value == 255)
            {
                item_content = "Filled with 0xFF";
            }
            else
            {
                item_content = "0x" + pad(hex_value.toString(16),2) + ", should be 0xFF";
                types_title = ScanaStudio.PacketColors.Error.Title;
                types_content = ScanaStudio.PacketColors.Error.Content;
            }
            break;
        }
    }//end switch (data_nb)
}//end function GNSS_DOPs

function Wind_Data(decoder_items) //130306
{
    var str = "";
    switch (data_nb)
    {
        case 0 :
        {
            item_content = "SID : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 1 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 2 :
        {
            multi_byte_value += (hex_value<<8);
            multi_byte_value = multi_byte_value*0.01;
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Wind Speed : " + multi_byte_value.toFixed(2) + " m/s");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(2) + " m/s");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Data",
                ("Wind Speed : " + multi_byte_value.toFixed(2) + " m/s"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 3 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 4 :
        {
            multi_byte_value += (hex_value<<8);
            multi_byte_value = multi_byte_value/10000;
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Wind Angle : " + multi_byte_value.toFixed(4) + " rad");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(4) + " m/s");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Data",
                ("Wind Angle : " + multi_byte_value.toFixed(4) + " rad"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 5 :
        {
            var reference = hex_value>>5;
            var reserved = hex_value&0x1F;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/8*3;
            switch (reference)
            {
                case 0 :
                {
                    str = "True (ground referenced to North)";
                    break;
                }
                case 1 :
                {
                    str = "Magnetic  (ground referenced to Magnetic North)";
                    break;
                }
                case 2 :
                {
                    str = "Apparent";
                    break;
                }
                case 3 :
                {
                    str = "True (boat referenced)";
                    break;
                }
                case 4 :
                {
                    str = "True (water  referenced)";
                    break;
                }
            }
            ScanaStudio.dec_item_new(decoder_items.channel_index,decoder_items.start_sample_index, end_item);
            ScanaStudio.dec_item_add_content("Reference : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                end_item,
                "Data",
                ("Reference : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            ScanaStudio.dec_item_new(decoder_items.channel_index,end_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Reserved : 0x" + pad(reserved.toString(16),2));
            ScanaStudio.dec_item_add_content("Reserved");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                end_item,
                decoder_items.end_sample_index,
                "Data",
                ("Reserved : 0x" + pad(reserved.toString(16),2)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 6 :
        case 7 :
        {
            item_content = "Reserved : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        default :
        {
            packet_title = "Filled Data";
            if (hex_value == 255)
            {
                item_content = "Filled with 0xFF";
            }
            else
            {
                item_content = "0x" + pad(hex_value.toString(16),2) + ", should be 0xFF";
                types_title = ScanaStudio.PacketColors.Error.Title;
                types_content = ScanaStudio.PacketColors.Error.Content;
            }
            break;
        }
    }//end switch (data_nb)
}//end function Wind_Data

function Environmental_Parameters(decoder_items) //130310
{
    var str = "";
    switch (data_nb)
    {
        case 0 :
        {
            item_content = "SID : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 1 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 2 :
        {
            multi_byte_value += (hex_value<<8);
            multi_byte_value = multi_byte_value*0.01;
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Water Temperature : " + multi_byte_value.toFixed(2) + " K");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(2) + " K");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Data",
                ("Water Temperature : " + multi_byte_value.toFixed(2) + " K"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 3 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 4 :
        {
            multi_byte_value += (hex_value<<8);
            multi_byte_value = multi_byte_value*0.01;
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Outside Ambient Air Temperature : " + multi_byte_value.toFixed(2) + " K");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(2) + " K");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Outside Ambient",
                ("Air Temperature : " + multi_byte_value.toFixed(2) + " K"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 5 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 6 :
        {
            multi_byte_value += (hex_value<<8);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Atmospheric Pressure : " + multi_byte_value + " hPa");
            ScanaStudio.dec_item_add_content(multi_byte_value + " hPa");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Data",
                ("Atmospheric Pressure : " + multi_byte_value + " hPa"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 7 :
        {
            item_content = "Reserved : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        default :
        {
            packet_title = "Filled Data";
            if (hex_value == 255)
            {
                item_content = "Filled with 0xFF";
            }
            else
            {
                item_content = "0x" + pad(hex_value.toString(16),2) + ", should be 0xFF";
                types_title = ScanaStudio.PacketColors.Error.Title;
                types_content = ScanaStudio.PacketColors.Error.Content;
            }
            break;
        }
    }//end switch (data_nb)
}//end function Environmental_Parameters

function Environmental_Parameters_2(decoder_items) //130311
{
    var str = "";
    switch (data_nb)
    {
        case 0 :
        {
            item_content = "SID : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 1 :
        {
            var temperature_source = hex_value>>2;
            var humidity_source = hex_value&0x3F;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/4*3;
            str = LOOKUP_TEMPERATURE_SOURCE(temperature_source);
            ScanaStudio.dec_item_new(decoder_items.channel_index,decoder_items.start_sample_index, end_item);
            ScanaStudio.dec_item_add_content("Temperature Source : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                end_item,
                "Data",
                ("Temperature Source : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            str = LOOKUP_HUMIDITY_SOURCE(humidity_source);
            ScanaStudio.dec_item_new(decoder_items.channel_index,end_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Humidity Source : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                end_item,
                decoder_items.end_sample_index,
                "Data",
                ("Humidity Source : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 2 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 3 :
        {
            multi_byte_value += (hex_value<<8);
            multi_byte_value = multi_byte_value*0.01;
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Temperature : " + multi_byte_value.toFixed(2) + " K");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(2) + " K");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Data",
                ("Temperature : " + multi_byte_value.toFixed(2) + " K"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 4 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 5 :
        {
            multi_byte_value += (hex_value<<8);
            multi_byte_value = multi_byte_value*100.0 / 25000.0;
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Humidity : " + multi_byte_value.toFixed(4) + "%");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(4) + "%");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Data",
                ("Humidity : " + multi_byte_value.toFixed(4) + "%"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 6 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 7 :
        {
            multi_byte_value += (hex_value<<8);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Atmospheric Pressure : " + multi_byte_value + " hPa");
            ScanaStudio.dec_item_add_content(multi_byte_value + " hPa");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Data",
                ("Atmospheric Pressure : " + multi_byte_value + " hPa"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        default :
        {
            packet_title = "Filled Data";
            if (hex_value == 255)
            {
                item_content = "Filled with 0xFF";
            }
            else
            {
                item_content = "0x" + pad(hex_value.toString(16),2) + ", should be 0xFF";
                types_title = ScanaStudio.PacketColors.Error.Title;
                types_content = ScanaStudio.PacketColors.Error.Content;
            }
            break;
        }
    }//end switch (data_nb)
}//end function Environmental_Parameters_2


function Temperature(decoder_items) //130312
{
    var str = "";
    switch (data_nb)
    {
        case 0 :
        {
            item_content = "SID : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 1 :
        {
            item_content = "Instance : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 2 :
        {
            str = LOOKUP_TEMPERATURE_SOURCE(hex_value);
            item_content = "Source : " + str;
            break;
        }
        case 3 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 4 :
        {
            multi_byte_value += (hex_value<<8);
            multi_byte_value = multi_byte_value*0.01;
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Actual Temperature : " + multi_byte_value.toFixed(2) + " K");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(2) + " K");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Data",
                ("Actual Temperature : " + multi_byte_value.toFixed(2) + " K"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 5 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 6 :
        {
            multi_byte_value += (hex_value<<8);
            multi_byte_value = multi_byte_value*0.01;
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Set Temperature : " + multi_byte_value.toFixed(2) + " K");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(2) + " K");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Data",
                ("Set Temperature : " + multi_byte_value.toFixed(2) + " K"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        default :
        {
            packet_title = "Filled Data";
            if (hex_value == 255)
            {
                item_content = "Filled with 0xFF";
            }
            else
            {
                item_content = "0x" + pad(hex_value.toString(16),2) + ", should be 0xFF";
                types_title = ScanaStudio.PacketColors.Error.Title;
                types_content = ScanaStudio.PacketColors.Error.Content;
            }
            break;
        }
    }//end switch (data_nb)
}//end function Temperature

function Humidity(decoder_items) //130313
{
    var str = "";
    switch (data_nb)
    {
        case 0 :
        {
            item_content = "SID : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 1 :
        {
            item_content = "Instance : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 2 :
        {
            str = LOOKUP_HUMIDITY_SOURCE(hex_value);
            item_content = "Source : " + str;
            break;
        }
        case 3 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 4 :
        {
            multi_byte_value += (hex_value<<8);
            multi_byte_value = multi_byte_value*100.0 / 25000.0;
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Actual Humidity : " + multi_byte_value.toFixed(4) + "%");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(4) + "%");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Data",
                ("Actual Humidity : " + multi_byte_value.toFixed(4) + "%"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 5 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 6 :
        {
            multi_byte_value += (hex_value<<8);
            multi_byte_value = multi_byte_value*100.0 / 25000.0;
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Set Humidity : " + multi_byte_value.toFixed(4) + "%");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(4) + "%");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Data",
                ("Set Humidity : " + multi_byte_value.toFixed(4) + "%"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        default :
        {
            packet_title = "Filled Data";
            if (hex_value == 255)
            {
                item_content = "Filled with 0xFF";
            }
            else
            {
                item_content = "0x" + pad(hex_value.toString(16),2) + ", should be 0xFF";
                types_title = ScanaStudio.PacketColors.Error.Title;
                types_content = ScanaStudio.PacketColors.Error.Content;
            }
            break;
        }
    }//end switch (data_nb)
}//end function Humidity

function Actual_Pressure(decoder_items) //130314/130315
{
    var str = "";
    switch (data_nb)
    {
        case 0 :
        {
            item_content = "SID : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 1 :
        {
            item_content = "Instance : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 2 :
        {
            str = LOOKUP_PRESSURE_SOURCE(hex_value);
            item_content = "Source : " + str;
            break;
        }
        case 3 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 4 :
        {
            multi_byte_value += (hex_value<<8);
            skip_item = true;
            break;
        }
        case 5 :
        {
            multi_byte_value += (hex_value<<16);
            skip_item = true;
            break;
        }
        case 6 :
        {
            multi_byte_value += hex_value*Math.pow(2,24);
            multi_byte_value = multi_byte_value*0.1;
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Pressure : " + multi_byte_value.toFixed(1).toString().replace(/(\d)(?=(\d{3})+\b)/g,'$1 ') + " dPa");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(1).toString().replace(/(\d)(?=(\d{3})+\b)/g,'$1 ') + " dPa");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Data",
                ("Pressure : " + multi_byte_value.toFixed(1).toString().replace(/(\d)(?=(\d{3})+\b)/g,'$1 ') + " dPa"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        default :
        {
            packet_title = "Filled Data";
            if (hex_value == 255)
            {
                item_content = "Filled with 0xFF";
            }
            else
            {
                item_content = "0x" + pad(hex_value.toString(16),2) + ", should be 0xFF";
                types_title = ScanaStudio.PacketColors.Error.Title;
                types_content = ScanaStudio.PacketColors.Error.Content;
            }
            break;
        }
    }//end switch (data_nb)
}//end function Actual_Pressure

function Temperature_Extended_Range(decoder_items) //130316
{
    var str = "";
    switch (data_nb)
    {
        case 0 :
        {
            item_content = "SID : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 1 :
        {
            item_content = "Instance : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 2 :
        {
            str = LOOKUP_TEMPERATURE_SOURCE(hex_value);
            item_content = "Source : " + str;
            break;
        }
        case 3 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 4 :
        {
            multi_byte_value += (hex_value<<8);
            skip_item = true;
            break;
        }
        case 5 :
        {
            multi_byte_value += (hex_value<<16);
            multi_byte_value = multi_byte_value*0.001;
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Temperature : " + multi_byte_value.toFixed(3) + " K");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(3) + " K");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Data",
                ("Temperature : " + multi_byte_value.toFixed(3) + " K"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 6 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 7 :
        {
            multi_byte_value += (hex_value<<8);
            multi_byte_value = multi_byte_value*0.1;
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Set Temperature : " + multi_byte_value.toFixed(1) + " K");
            ScanaStudio.dec_item_add_content(multi_byte_value.toFixed(1) + " K");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Data",
                ("Set Temperature : " + multi_byte_value.toFixed(1) + " K"),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        default :
        {
            packet_title = "Filled Data";
            if (hex_value == 255)
            {
                item_content = "Filled with 0xFF";
            }
            else
            {
                item_content = "0x" + pad(hex_value.toString(16),2) + ", should be 0xFF";
                types_title = ScanaStudio.PacketColors.Error.Title;
                types_content = ScanaStudio.PacketColors.Error.Content;
            }
            break;
        }
    }//end switch (data_nb)
}//end function Temperature_Extended_Range

function Position_Delta_Rapid_Update (decoder_items) //129027
{
    var str = "";
    switch (data_nb)
    {
        case 0 :
        {
            item_content = "SID : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 1 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 2 :
        {
            multi_byte_value += (hex_value<<8);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Time Delta : 0x" + pad(multi_byte_value.toString(16),4));
            ScanaStudio.dec_item_add_content("0x" + pad(multi_byte_value.toString(16),4));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Data",
                ("Time Delta : 0x" + pad(multi_byte_value.toString(16),4)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 3 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 4 :
        {
            multi_byte_value += (hex_value<<8);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Latitude Delta : 0x" + pad(multi_byte_value.toString(16),4));
            ScanaStudio.dec_item_add_content("0x" + pad(multi_byte_value.toString(16),4));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Data",
                ("Latitude Delta : 0x" + pad(multi_byte_value.toString(16),4)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 5 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 6 :
        {
            multi_byte_value += (hex_value<<8);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Longitude Delta : 0x" + pad(multi_byte_value.toString(16),4));
            ScanaStudio.dec_item_add_content("0x" + pad(multi_byte_value.toString(16),4));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Data",
                ("Longitude Delta : 0x" + pad(multi_byte_value.toString(16),4)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        default :
        {
            packet_title = "Filled Data";
            if (hex_value == 255)
            {
                item_content = "Filled with 0xFF";
            }
            else
            {
                item_content = "0x" + pad(hex_value.toString(16),2) + ", should be 0xFF";
                types_title = ScanaStudio.PacketColors.Error.Title;
                types_content = ScanaStudio.PacketColors.Error.Content;
            }
            break;
        }
    }//end switch (data_nb)
}//end funciton Position_Delta_Rapid_Update

/* IDK why but it's 10 bytes long and it's described has a single packet
function Altitude_Delta_Rapid_Update (decoder_items) //129028
{
    var str = "";
    switch (data_nb)
    {
        case 0 :
        {
            item_content = "SID : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 1 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 2 :
        {
            multi_byte_value += (hex_value<<8);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Time Delta : 0x" + pad(multi_byte_value.toString(16),4));
            ScanaStudio.dec_item_add_content("0x" + pad(multi_byte_value.toString(16),4));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Data",
                ("Time Delta : 0x" + pad(multi_byte_value.toString(16),4)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 3 :
        {
            var GNSS_quality = hex_value>>6;
            var direction = (hex_value>>4)&0x3;
            var reserved = hex_value&0xF;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/8*2;
            ScanaStudio.dec_item_new(decoder_items.channel_index,decoder_items.start_sample_index, end_item);
            ScanaStudio.dec_item_add_content("GNSS Delta : 0x" + pad(GNSS_quality.toString(16),1));
            ScanaStudio.dec_item_add_content("0x" + pad(GNSS_quality.toString(16),1));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                end_item,
                "Data",
                ("GNSS Delta : 0x" + pad(GNSS_quality.toString(16),1)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            start_item = end_item;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/8*2;
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item, end_item);
            ScanaStudio.dec_item_add_content("Direction : 0x" + pad(direction.toString(16),1));
            ScanaStudio.dec_item_add_content("0x" + pad(direction.toString(16),1));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                end_item,
                "Data",
                ("Direction : 0x" + pad(direction.toString(16),1)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            ScanaStudio.dec_item_new(decoder_items.channel_index,end_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Reserved : 0x" + pad(reserved.toString(16),1));
            ScanaStudio.dec_item_add_content("0x" + pad(reserved.toString(16),1));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                end_item,
                decoder_items.end_sample_index,
                "Data",
                ("Reserved : 0x" + pad(reserved.toString(16),1)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 4 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 5 :
        {
            multi_byte_value += (hex_value<<8);
            skip_item = true;
            break;
        }
        case 6 :
        {
            multi_byte_value += (hex_value<<16);
            skip_item = true;
            break;
        }
        case 7 :
        {
            multi_byte_value += hex_value*Math.pow(2,24);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Reserved : 0x" + pad(reserved.toString(16),1));
            ScanaStudio.dec_item_add_content("0x" + pad(reserved.toString(16),1));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Data",
                ("Reserved : 0x" + pad(reserved.toString(16),1)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);

            skip_item = true;
            break;
        }
        default :
        {
            packet_title = "Filled Data";
            if (hex_value == 255)
            {
                item_content = "Filled with 0xFF";
            }
            else
            {
                item_content = "0x" + pad(hex_value.toString(16),2) + ", should be 0xFF";
                types_title = ScanaStudio.PacketColors.Error.Title;
                types_content = ScanaStudio.PacketColors.Error.Content;
            }
            break;
        }
    }//end switch (data_nb)
}//end funciton Altitude_Delta_Rapid_Update
*/

//------------------------------------------------------------------------------------------------------------------------------------------//
//                                                 Proprietary SINGLE FRAME PGN                                                             //
//------------------------------------------------------------------------------------------------------------------------------------------//

function proprietary_single_frame (decoder_items) //61184/61440/65280/65284/65285/65286/65287/65288/65289/65290/65292/65293/65309/65312/65325/65341/65345/65359/65360/65361/65371/65374/65379/65408/65409/65410/65480/130824
{
    var str = "";
    switch (data_nb)
    {
        case 0 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 1 :
        {
            var manufacturer_code = multi_byte_value + ((hex_value>>5)<<8);
            var reserved = (hex_value>>3)&0x3;
            var industry_code = hex_value&0x7;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/8*3;
            str = LOOKUP_MANUFACTURER(manufacturer_code);
            ScanaStudio.dec_item_new(decoder_items.channel_index, start_item, end_item);
            ScanaStudio.dec_item_add_content("Manufacturer Code : " + str);
            ScanaStudio.dec_item_add_content("" + str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                end_item,
                "Single Frame Data",
                ("Manufacturer Code : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            start_item = end_item;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)/8*5;
            ScanaStudio.dec_item_new(decoder_items.channel_index, start_item, end_item);
            ScanaStudio.dec_item_add_content("Reserved : 0x" + pad(reserved.toString(16),1));
            ScanaStudio.dec_item_add_content("Reserved");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                end_item,
                "Single Frame Data",
                ("Reserved : 0x" + pad(reserved.toString(16),1)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            str = LOOKUP_INDUSTRY_CODE(industry_code);
            ScanaStudio.dec_item_new(decoder_items.channel_index, end_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Industry Code : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                end_item,
                decoder_items.end_sample_index,
                "Single Frame Data",
                ("Industry Code : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        default :
        {
            packet_title = "Data Byte n°" + (data_nb+1);
            item_content = "0x" + pad(hex_value.toString(16),2);
            break;
        }
    }
}

//------------------------------------------------------------------------------------------------------------------------------------------//
//                                                   END Proprietary SINGLE FRAME PGN                                                       //
//------------------------------------------------------------------------------------------------------------------------------------------//

function ISO_Acknowledgement(decoder_items)
{
    var str = "";
    switch (data_nb)
    {
        case 0 :
        {
            var alert_type = (hex_value>>4);
            var alert_category = hex_value&0xF;
            switch (alert_type)
            {
                case 0 :
                {
                    str = "ACK";
                    break;
                }
                case 1 :
                {
                    str = "NAK";
                    break;
                }
                case 2 :
                {
                    str = "Access Denied";
                    break;
                }
                case 3 :
                {
                    str = "Address Busy";
                    break;
                }
                default :
                {
                    str = "Reserved";
                    break;
                }
            }
            item_content = "Control : " + str;
            break;
        }
        case 1 :
        {
            item_content = "Group Function : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 2 :
        case 3 :
        case 4 :
        {
            item_content = "Reserved 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 5 :
        {
            start_item = decoder_items.start_sample_index;
            pgn_ps = hex_value;
            skip_item = true;
            break;
        }
        case 6 :
        {
            pgn_pf = hex_value;
            skip_item = true;
            break;
        }
        case 7 :
        {
            pgn_dp = hex_value;
            var pgn = (pgn_dp<<16) + (pgn_pf<<8) + pgn_ps;
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("PGN : " + pgn + " or 0x" + pad(pgn.toString(16),5));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Data",
                ("PGN : " + pgn + " or 0x" + pad(pgn.toString(16),5)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        default :
        {
            packet_title = "Filled Data";
            if (hex_value == 255)
            {
                item_content = "Filled with 0xFF";
            }
            else
            {
                item_content = "0x" + pad(hex_value.toString(16),2) + ", should be 0xFF";
                types_title = ScanaStudio.PacketColors.Error.Title;
                types_content = ScanaStudio.PacketColors.Error.Content;
            }
            break;
        }
    }//end switch (data_nb)
}//end function ISO_Acknowledgement

function ISO_Adress_Claim(decoder_items)
{
    var str = "";
    switch (data_nb)
    {
        case 0 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 1 :
        {
            multi_byte_value += (hex_value<<8);
            skip_item = true;
            break;
        }
        case 2 :
        {
            multi_byte_value += ((hex_value>>3)<<16);
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)*3/8;
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,end_item);
            ScanaStudio.dec_item_add_content("Unique Number : 0x" + pad(multi_byte_value.toString(16),6));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Data",
                ("Unique Number : 0x" + pad(multi_byte_value.toString(16),6)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            multi_byte_value = (hex_value)&0x7;
            start_item = end_item;
            skip_item = true;
            break;
        }
        case 3 :
        {
            multi_byte_value += (hex_value<<3);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Manufacturer Code : 0x" + pad(multi_byte_value.toString(16),3));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Data",
                ("Manufacturer Code : 0x" + pad(multi_byte_value.toString(16),6)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 4 :
        {
            var device_low = (hex_value>>5);
            var device_high = hex_value&0x1F;
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)*3/8;
            ScanaStudio.dec_item_new(decoder_items.channel_index,decoder_items.start_sample_index,end_item);
            ScanaStudio.dec_item_add_content("Device Instance Lower : 0x" + pad(device_low.toString(16),1));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                end_item,
                "Data",
                ("Device Instance Lower : 0x" + pad(device_low.toString(16),1)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            ScanaStudio.dec_item_new(decoder_items.channel_index,end_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Device Instance Upper : 0x" + pad(device_high.toString(16),2));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                end_item,
                decoder_items.end_sample_index,
                "Data",
                ("Device Instance Upper : 0x" + pad(device_high.toString(16),2)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 5 :
        {
            item_content = "Device Function : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 6 :
        {
            var reserved = hex_value>>7;
            var device_class = hex_value&0x7F;
            var str = "";
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)*1/8;
            ScanaStudio.dec_item_new(decoder_items.channel_index,decoder_items.start_sample_index,end_item);
            ScanaStudio.dec_item_add_content("Reserved : 0x" + pad(reserved.toString(16),1));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                end_item,
                "Data",
                ("Reserved : 0x" + pad(reserved.toString(16),1)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            switch (device_class)
            {
                case 0 :
                {
                    str = "Reserved for 2000 Use";
                    break;
                }
                case 10 :
                {
                    str = "System tools";
                    break;
                }
                case 20 :
                {
                    str = "Safety systems";
                    break;
                }
                case 25 :
                {
                    str = "Internetwork device";
                    break;
                }
                case 30 :
                {
                    str = "Electrical Distribution";
                    break;
                }
                case 35 :
                {
                    str = "Electrical Generation";
                    break;
                }
                case 40 :
                {
                    str = "Steering and Control surfaces";
                    break;
                }
                case 50 :
                {
                    str = "Propulsion";
                    break;
                }
                case 60 :
                {
                    str = "Navigation";
                    break;
                }
                case 70 :
                {
                    str = "Communication";
                    break;
                }
                case 75 :
                {
                    str = "Sensor Communication Interface";
                    break;
                }
                case 80 :
                {
                    str = "Instrumentation/general systems";
                    break;
                }
                case 85 :
                {
                    str = "External Environment";
                    break;
                }
                case 90 :
                {
                    str = "Internal Environment";
                    break;
                }
                case 100 :
                {
                    str = "Deck + cargo + fishing equipment systems";
                    break;
                }
                case 120 :
                {
                    str = "Display";
                    break;
                }
                case 125 :
                {
                    str = "Entertainment";
                    break;
                }
                default :
                {
                    str = "Unknown";
                    break;
                }
            }
            ScanaStudio.dec_item_new(decoder_items.channel_index,end_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Device Class : " + str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                end_item,
                decoder_items.end_sample_index,
                "Data",
                ("Device Class : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 7 :
        {
            var system_instance = hex_value>>4;
            var industry_code = (hex_value>>1)&0x7;
            var reserved = hex_value&0x1;
            var str = "";
            end_item = decoder_items.start_sample_index + 4*(decoder_items.end_sample_index - decoder_items.start_sample_index)/8;
            ScanaStudio.dec_item_new(decoder_items.channel_index,decoder_items.start_sample_index, end_item);
            ScanaStudio.dec_item_add_content("System Instance : 0x" + pad(system_instance.toString(16),1));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                end_item,
                "Data",
                ("System Instance : 0x" + pad(system_instance.toString(16),1)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            str = LOOKUP_INDUSTRY_CODE(industry_code);
            start_item = end_item;
            end_item = decoder_items.start_sample_index + 7*(decoder_items.end_sample_index - decoder_items.start_sample_index)/8;
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item, end_item);
            ScanaStudio.dec_item_add_content("System Instance : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                end_item,
                "Data",
                ("System Instance : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            ScanaStudio.dec_item_new(decoder_items.channel_index,end_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Reserved : 0x" + pad(reserved.toString(16),1));
            ScanaStudio.dec_item_add_content("Reserved");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                end_item,
                decoder_items.end_sample_index,
                "Data",
                ("Reserved : 0x" + pad(reserved.toString(16),1)),
                ScanaStudio.PacketColors.Misc.Title,
                ScanaStudio.PacketColors.Misc.Content);
            skip_item = true;
            break;
        }
        default :
        {
            packet_title = "Filled Data";
            if (hex_value == 255)
            {
                item_content = "Filled with 0xFF";
            }
            else
            {
                item_content = "0x" + pad(hex_value.toString(16),2) + ", should be 0xFF";
                types_title = ScanaStudio.PacketColors.Error.Title;
                types_content = ScanaStudio.PacketColors.Error.Content;
            }
            break;
        }
    }//end switch (data_nb)
}//end function ISO_Adress_Claim

//------------------------------------------------------------------------------------------------------------------------------------------//
//                                              END Single Frame Packet Functions                                                           //
//------------------------------------------------------------------------------------------------------------------------------------------//


//------------------------------------------------------------------------------------------------------------------------------------------//
//                                              ISO11783 Packet Functions                                                                   //
//------------------------------------------------------------------------------------------------------------------------------------------//

function ISO_Commanded_Address(decoder_items)
{
    var str = "";
    switch (byte_nb)
    {
        case 1 :
        {
            start_item = decoder_items.start_sample_index;
            multi_byte_value = hex_value;
            skip_item = true;
            break;
        }
        case 2 :
        {
            multi_byte_value += (hex_value<<8);
            skip_item = true;
            break;
        }
        case 3 :
        {
            multi_byte_value += ((hex_value>>3)<<16);
            end_item = decoder_items.start_sample_index + 5*(decoder_items.end_sample_index - decoder_items.start_sample_index)/8;
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,end_item);
            ScanaStudio.dec_item_add_content("Unique Number : 0x" + pad(multi_byte_value.toString(16),6));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Data byte n°1-" + byte_nb,
                ("Unique Number : 0x" + pad(multi_byte_value.toString(16),6)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            multi_byte_value = (hex_value)&0x7;
            start_item = end_item;
            skip_item = true;
            break;
        }
        case 4 :
        {
            multi_byte_value += (hex_value<<3);
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Manufacturer Code : 0x" + pad(multi_byte_value.toString(16),3));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                decoder_items.end_sample_index,
                "Data byte n°3-" + byte_nb,
                ("Manufacturer Code : 0x" + pad(multi_byte_value.toString(16),6)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 5 :
        {
            var device_low = (hex_value>>5);
            var device_high = hex_value&0x1F;
            end_item = decoder_items.start_sample_index + 5*(decoder_items.end_sample_index - decoder_items.start_sample_index)/8;
            ScanaStudio.dec_item_new(decoder_items.channel_index,decoder_items.start_sample_index,end_item);
            ScanaStudio.dec_item_add_content("Device Instance Lower : 0x" + pad(device_low.toString(16),1));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                end_item,
                "Data byte n°" + byte_nb,
                ("Device Instance Lower : 0x" + pad(device_low.toString(16),1)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            ScanaStudio.dec_item_new(decoder_items.channel_index,end_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Device Instance Upper : 0x" + pad(device_high.toString(16),2));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                end_item,
                decoder_items.end_sample_index,
                "Data byte n°" + byte_nb,
                ("Device Instance Upper : 0x" + pad(device_high.toString(16),2)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 6 :
        {
            item_content = "Device Function : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        case 7 :
        {
            var reserved = hex_value>>7;
            var device_class = hex_value&0x7F;
            var str = "";
            end_item = decoder_items.start_sample_index + (decoder_items.end_sample_index - decoder_items.start_sample_index)*1/8;
            ScanaStudio.dec_item_new(decoder_items.channel_index,decoder_items.start_sample_index,end_item);
            ScanaStudio.dec_item_add_content("Reserved : 0x" + pad(reserved.toString(16),1));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                end_item,
                "Data byte n°" + byte_nb,
                ("Reserved : 0x" + pad(reserved.toString(16),1)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            switch (device_class)
            {
                case 0 :
                {
                    str = "Reserved for 2000 Use";
                    break;
                }
                case 10 :
                {
                    str = "System tools";
                    break;
                }
                case 20 :
                {
                    str = "Safety systems";
                    break;
                }
                case 25 :
                {
                    str = "Internetwork device";
                    break;
                }
                case 30 :
                {
                    str = "Electrical Distribution";
                    break;
                }
                case 35 :
                {
                    str = "Electrical Generation";
                    break;
                }
                case 40 :
                {
                    str = "Steering and Control surfaces";
                    break;
                }
                case 50 :
                {
                    str = "Propulsion";
                    break;
                }
                case 60 :
                {
                    str = "Navigation";
                    break;
                }
                case 70 :
                {
                    str = "Communication";
                    break;
                }
                case 75 :
                {
                    str = "Sensor Communication Interface";
                    break;
                }
                case 80 :
                {
                    str = "Instrumentation/general systems";
                    break;
                }
                case 85 :
                {
                    str = "External Environment";
                    break;
                }
                case 90 :
                {
                    str = "Internal Environment";
                    break;
                }
                case 100 :
                {
                    str = "Deck + cargo + fishing equipment systems";
                    break;
                }
                case 120 :
                {
                    str = "Display";
                    break;
                }
                case 125 :
                {
                    str = "Entertainment";
                    break;
                }
                default :
                {
                    str = "Unknown";
                    break;
                }
            }
            ScanaStudio.dec_item_new(decoder_items.channel_index,end_item,decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Device Class : " + str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                end_item,
                decoder_items.end_sample_index,
                "Data byte n°" + byte_nb,
                ("Device Class : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 8 :
        {
            var system_instance = hex_value>>4;
            var industry_code = (hex_value>>1)&0x7;
            var reserved = hex_value&0x1;
            var str = "";
            end_item = decoder_items.start_sample_index + 4*(decoder_items.end_sample_index - decoder_items.start_sample_index)/8;
            ScanaStudio.dec_item_new(decoder_items.channel_index,decoder_items.start_sample_index, end_item);
            ScanaStudio.dec_item_add_content("System Instance : 0x" + pad(system_instance.toString(16),1));
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                decoder_items.start_sample_index,
                end_item,
                "Data byte n°" + byte_nb,
                ("System Instance : 0x" + pad(system_instance.toString(16),1)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            str = LOOKUP_INDUSTRY_CODE(industry_code);
            start_item = end_item;
            end_item = decoder_items.start_sample_index + 7*(decoder_items.end_sample_index - decoder_items.start_sample_index)/8;
            ScanaStudio.dec_item_new(decoder_items.channel_index,start_item, end_item);
            ScanaStudio.dec_item_add_content("Industry Code : " + str);
            ScanaStudio.dec_item_add_content(str);
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                start_item,
                end_item,
                "Data byte n°" + byte_nb,
                ("Industry Code : " + str),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            ScanaStudio.dec_item_new(decoder_items.channel_index,end_item, decoder_items.end_sample_index);
            ScanaStudio.dec_item_add_content("Reserved : 0x" + pad(reserved.toString(16),1));
            ScanaStudio.dec_item_add_content("Reserved");
            ScanaStudio.dec_item_end();
            // Packet View
            ScanaStudio.packet_view_add_packet(false,
                decoder_items.channel_index,
                end_item + 1,
                decoder_items.end_sample_index,
                "Data byte n°" + byte_nb,
                ("Reserved : 0x" + pad(reserved.toString(16),1)),
                ScanaStudio.PacketColors.Data.Title,
                ScanaStudio.PacketColors.Data.Content);
            skip_item = true;
            break;
        }
        case 9 :
        {
            item_content = "New Source Address : 0x" + pad(hex_value.toString(16),2);
            break;
        }
        default :
        {
            packet_title = "Filled Data";
            if (hex_value == 255)
            {
                item_content = "Filled with 0xFF";
            }
            else
            {
                item_content = "0x" + pad(hex_value.toString(16),2) + ", should be 0xFF";
                types_title = ScanaStudio.PacketColors.Error.Title;
                types_content = ScanaStudio.PacketColors.Error.Content;
            }
            break;
        }
    }//end switch (data_nb)
}//end function ISO_Commanded_Address


//------------------------------------------------------------------------------------------------------------------------------------------//
//                                                  END ISO11783 Packet Functions                                                           //
//------------------------------------------------------------------------------------------------------------------------------------------//

//------------------------------------------------------------------------------------------------------------------------------------------//
//                                                  NMEA_2000 Usefull Functions                                                             //
//------------------------------------------------------------------------------------------------------------------------------------------//

function is_fast_packet (pgn)
{
    switch (pgn)
    {
        case 65536 :
        case 126208 :
        case 126464 :
        case 126720 :
        case 126976 :
        case 126983 :
        case 126984 :
        case 126985 :
        case 126986 :
        case 126987 :
        case 126988 :
        case 126996 :
        case 126998 :
        case 127233 :
        case 127237 :
        case 127489 :
        case 127496 :
        case 127497 :
        case 127498 :
        case 127500 :
        case 127503 :
        case 127510 :
        case 127513 :
        case 128275 :
        case 128520 :
        case 129029 :
        case 129038 :
        case 129039 :
        case 129040 :
        case 129041 :
        case 129044 :
        case 129045 :
        case 129284 :
        case 129285 :
        case 129301 :
        case 129302 :
        case 129538 :
        case 129540 :
        case 129541 :
        case 129542 :
        case 129545 :
        case 129547 :
        case 129549 :
        case 129550 :
        case 129551 :
        case 129556 :
        case 129792 :
        case 129793 :
        case 129794 :
        case 129795 :
        case 129796 :
        case 129797 :
        case 129798 :
        case 129799 :
        case 129800 :
        case 129801 :
        case 129802 :
        case 129804 :
        case 129805 :
        case 129806 :
        case 129807 :
        case 129808 :
        case 129809 :
        case 129810 :
        case 130060 :
        case 130061 :
        case 130064 :
        case 130065 :
        case 130066 :
        case 130067 :
        case 130068 :
        case 130069 :
        case 130070 :
        case 130071 :
        case 130072 :
        case 130073 :
        case 130074 :
        case 130320 :
        case 130321 :
        case 130322 :
        case 130323 :
        case 130324 :
        case 130560 :
        case 130567 :
        case 130569 :
        case 130570 :
        case 130571 :
        case 130572 :
        case 130573 :
        case 130574 :
        case 130577 :
        case 130578 :
        case 130579 :
        case 130580 :
        case 130581 :
        case 130582 :
        case 130583 :
        case 130584 :
        case 130585 :
        case 130586 :
        case 130816 :
        case 130817 :
        case 130818 :
        case 130819 :
        case 130820 :
        case 130821 :
        case 130824 :
        case 130827 :
        case 130828 :
        case 130831 :
        case 130832 :
        case 130834 :
        case 130835 :
        case 130836 :
        case 130837 :
        case 130838 :
        case 130839 :
        case 130840 :
        case 130842 :
        case 130843 :
        case 130845 :
        case 130847 :
        case 130850 :
        case 130851 :
        case 130856 :
        case 130880 :
        case 130881 :
        case 130944 :
        {
            fast_packet = true;
            break;
        }
        default :
        {
            fast_packet = false;
            break;
        }
    }//end switch (pgn)
}//end function is_fast_packet

function get_pgn_name(pgn)
{
    switch (pgn)
    {
        case 59392 :
        {
            pgn_name = "ISO Acknowledgement";
            break;
        }
        case 59904 :
        {
            pgn_name = "ISO Request";
            break;
        }
        case 60160 :
        {
            pgn_name = "ISO TP, Data Transfer";
            break;
        }
        case 60416 :
        {
            pgn_name = "ISO TP, Connection Management";
            break;
        }
        case 60928 :
        {
            pgn_name = "ISO Address Claim";
            break;
        }
        case 65001 :
        {
            pgn_name = "Bus#1 Phase C Basic AC Quantities";
            break;
        }
        case 65002 :
        {
            pgn_name = "Bus#1 Phase B Basic AC Quantities";
            break;
        }
        case 65003 :
        {
            pgn_name = "Bus#1 Phase A Basic AC Quantities";
            break;
        }
        case 65004 :
        {
            pgn_name = "Bus#1 Average Basic AC Quantities";
            break;
        }
        case 65005 :
        {
            pgn_name = "Utility Total AC Energy";
            break;
        }
        case 65006 :
        {
            pgn_name = "Utility Phase C AC Reactive Power";
            break;
        }
        case 65007 :
        {
            pgn_name = "Utility Phase C AC Power";
            break;
        }
        case 65008 :
        {
            pgn_name = "Utility Phase C Basic AC Quantities";
            break;
        }
        case 65009 :
        {
            pgn_name = "Utility Phase B AC Reactive Power";
            break;
        }
        case 65010 :
        {
            pgn_name = "Utility Phase B AC Power";
            break;
        }
        case 65011 :
        {
            pgn_name = "Utility Phase B Basic AC Quantities";
            break;
        }
        case 65012 :
        {
            pgn_name = "Utility Phase A AC Reactive Power";
            break;
        }
        case 65013 :
        {
            pgn_name = "Utility Phase A AC Power";
            break;
        }
        case 65014 :
        {
            pgn_name = "Utility Phase A Basic AC Quantities";
            break;
        }
        case 65015 :
        {
            pgn_name = "Utility Total AC Reactive Power";
            break;
        }
        case 65016 :
        {
            pgn_name = "Utility Total AC Power";
            break;
        }
        case 65017 :
        {
            pgn_name = "Utility Average Basic AC Quantities";
            break;
        }
        case 65018 :
        {
            pgn_name = "Generator Total AC Energy";
            break;
        }
        case 65019 :
        {
            pgn_name = "Gene Phase C AC Reactive Power";
            break;
        }
        case 65020 :
        {
            pgn_name = "Generator Phase C AC Power";
            break;
        }
        case 65021 :
        {
            pgn_name = "Gene Phase C Basic AC Quantities";
            break;
        }
        case 65022 :
        {
            pgn_name = "Gene Phase B AC Reactive Power";
            break;
        }
        case 65023 :
        {
            pgn_name = "Generator Phase B AC Power";
            break;
        }
        case 65024 :
        {
            pgn_name = "Gene Phase B Basic AC Quantities";
            break;
        }
        case 65025 :
        {
            pgn_name = "Gene Phase A AC Reactive Power";
            break;
        }
        case 65026 :
        {
            pgn_name = "Gene Phase A AC Power";
            break;
        }
        case 65027 :
        {
            pgn_name = "Gene Phase A Basic AC Quantities";
            break;
        }
        case 65028 :
        {
            pgn_name = "Gene Total AC Reactive Power";
            break;
        }
        case 65029 :
        {
            pgn_name = "Generator Total AC Power";
            break;
        }
        case 65030 :
        {
            pgn_name = "Gene Average Basic AC Quantities";
            break;
        }
        case 126208 :
        {
            pgn_name = "NMEA";
            break;
        }
        case 126720 :
        {
            pgn_name = "Proprietary fast packet PGN";
            break;
        }
        case 126983 :
        {
            pgn_name = "Alert Data";
            break;
        }
        case 126984 :
        {
            pgn_name = "Alert RSP Data";
            break;
        }
        case 126985 :
        {
            pgn_name = "Alert Text Data";
            break;
        }
        case 126992 :
        {
            pgn_name = "System Time";
            break;
        }
        case 126993 :
        {
            pgn_name = "Heartbeat";
            break;
        }
        case 126996 :
        {
            pgn_name = "Product Information";
            break;
        }
        case 126998 :
        {
            pgn_name = "Configuration Information";
            break;
        }
        case 127233 :
        {
            pgn_name = "Man Overboard Notification";
            break;
        }
        case 127237 :
        {
            pgn_name = "Heading Track Control";
            break;
        }
        case 127245 :
        {
            pgn_name = "Rudder";
            break;
        }
        case 127250 :
        {
            pgn_name = "Vessel Heading";
            break;
        }
        case 127251 :
        {
            pgn_name = "Rate of Turn";
            break;
        }
        case 127257 :
        {
            pgn_name = "Attitude";
            break;
        }
        case 127258 :
        {
            pgn_name = "Magnetic Variation";
            break;
        }
        case 127488 :
        {
            pgn_name = "Engine Parameters, Rapid Update";
            break;
        }
        case 127489 :
        {
            pgn_name = "Engine Parameter Dynamic";
            break;
        }
        case 127493 :
        {
            pgn_name = "Transmission Parameters, Dynamic";
            break;
        }
        case 127496 :
        {
            pgn_name = "Trip Parameters Vessel";
            break;
        }
        case 127497 :
        {
            pgn_name = "Trip Parameters Engine";
            break;
        }
        case 127498 :
        {
            pgn_name = "Trip Parameters Static";
            break;
        }
        case 127500 :
        {
            pgn_name = "Load Controller Connection State Control";
            break;
        }
        case 127501 :
        {
            pgn_name = "Binary Switch Bank Status";
            break;
        }
        case 127502 :
        {
            pgn_name = "Switch Bank Control";
            break;
        }
        case 127505 :
        {
            pgn_name = "Fluid Level";
            break;
        }
        case 127507 :
        {
            pgn_name = "Charger Status";
            break;
        }
        case 127508 :
        {
            pgn_name = "Battery Status";
            break;
        }
        case 127509 :
        {
            pgn_name = "Inverter Status";
            break;
        }
        case 128000 :
        {
            pgn_name = "Leeway Angle";
            break;
        }
        case 128259 :
        {
            pgn_name = "Speed";
            break;
        }
        case 128267 :
        {
            pgn_name = "Water Depth";
            break;
        }
        case 128275 :
        {
            pgn_name = "Distance Log";
            break;
        }
        case 128520 :
        {
            pgn_name = "Tracked Target Data";
            break;
        }
        case 129025 :
        {
            pgn_name = "Position, Rapid Update";
            break;
        }
        case 129026 :
        {
            pgn_name = "COG&SOG, Rapid Update";
            break;
        }
        case 129027 :
        {
            pgn_name = "Position Delta, Rapid Update";
            break;
        }
        case 129033 :
        {
            pgn_name = "Time & Date";
            break;
        }
        case 129038 :
        {
            pgn_name = "AIS Class A Position Report";
            break;
        }
        case 129039 :
        {
            pgn_name = "AIS Class B Position Report";
            break;
        }
        case 129040 :
        {
            pgn_name = "AIS Class B Extended Position Report";
            break;
        }
        case 129041 :
        {
            pgn_name = "AIS Aids to Navigation Report";
            break;
        }
        case 129044 :
        {
            pgn_name = "Datum";
            break;
        }
        case 129045 :
        {
            pgn_name = "User Datum";
            break;
        }
        case 129283 :
        {
            pgn_name = "Cross Track Error";
            break;
        }
        case 129284 :
        {
            pgn_name = "Navigation Data";
            break;
        }
        case 129539 :
        {
            pgn_name = "GNSS DOPs";
            break;
        }
        case 129794 :
        {
            pgn_name = "AIS Class A Static and Voyage Related Data";
            break;
        }
        case 129795 :
        {
            pgn_name = "AIS Addressed Binary Message";
            break;
        }
        case 129796 :
        {
            pgn_name = "AIS Acknowledge";
            break;
        }
        case 129797 :
        {
            pgn_name = "AIS Binary Broadcast Message";
            break;
        }
        case 129809 :
        {
            pgn_name = "AIS Class B static data part A";
            break;
        }
        case 129810 :
        {
            pgn_name = "AIS Class B static data part B";
            break;
        }
        case 130306 :
        {
            pgn_name = "Wind Data";
            break;
        }
        case 130310 :
        {
            pgn_name = "Environmental Parameters";
            break;
        }
        case 130311 :
        {
            pgn_name = "Environmental Parameters 2";
            break;
        }
        case 130312 :
        {
            pgn_name = "Temperature";
            break;
        }
        case 130313 :
        {
            pgn_name = "Humidity";
            break;
        }
        case 130314 :
        {
            pgn_name = "Actual Pressure";
            break;
        }
        case 130315 :
        {
            pgn_name = "Set Pressure";
            break;
        }
        case 130316 :
        {
            pgn_name = "Temperature Extended Range";
            break;
        }
        case 130320 :
        {
            pgn_name = "Tide Station Data";
            break;
        }
        case 130321 :
        {
            pgn_name = "Salinity Station Data";
            break;
        }
        case 130567 :
        {
            pgn_name = "Watermaker Input Setting and Status";
            break;
        }
        case 130578 :
        {
            pgn_name = "Vessel Speed Components";
            break;
        }
        default :
        {
            pgn_name = "UNKNOWN PGN NAME AND DATA FIELDS";
        }
    }//end switch (pgn)
}//end function get_pgn_name

/*  A helper function add leading "0"s to numbers
      Parameters
        * num_str: A string of the number to be be 0-padded
        * size: The total wanted size of the output string
*/
function pad(num_str, size) {
    while (num_str.length < size) num_str = "0" + num_str;
    return num_str;
}

function display_data (data, format)
{
    if (format == 0)
    {
        if (data == 255)
        {
            item_content = "0x" + pad(data.toString(16),2) + " (Data isn't available)";
        }
        else
        {
            item_content = "0x" + pad(data.toString(16),2);
        }
    }
    else if (format == 1)
    {
        if (data == 255)
        {
            item_content = "0b" + pad(data.toString(2),8) + " (Data isn't available)";
        }
        else
        {
            item_content = "0b" + pad(data.toString(2),8);
        }
    }
    else
    {
        if (data == 255)
        {
            item_content = data + " (Data isn't available)";
        }
        else
        {
            item_content = data;
        }
    }
}

function get_hex_value (content, format)
{
    var parenthesis = /[(]/g;
    if ((content.search("Extended ID")) == -1) // Test if it's  the base ID content or full extended ID
    {
        switch (format)
        {
            case 0 : // HEX
            {
                var value_place = content.search("0x");
                if (value_place != -1)
                {
                    var hex_value = content.substr(value_place, 5);
                    hex_value = parseInt(hex_value, 16);
                }
                break;
            }
            case 1 : // Bin
            {
                var value_place = content.search("0b");
                if (value_place != -1)
                {
                    var hex_value = content.substr(value_place + 2, 13);
                    while (hex_value.search(" ") != -1)
                    {
                        hex_value = hex_value.replace(" ", "");
                    }
                    hex_value = parseInt(hex_value,2);
                }
                break;
            }
            case 2 : // Décimal
            {
                var value_place = content.search("=");
                if (value_place != -1)
                {
                    var hex_value = content.substr(value_place + 2, 5);
                    hex_value = parseInt(hex_value, 10);
                }
                break;
            }
        }
    }
    else
    {
        var parenthesis_place = content.search(parenthesis);
        switch (format)
        {
            case 0 : // HEX
            {
                var value_place = content.search("0x");
                if (value_place != -1)
                {
                    var hex_value = content.substr(value_place + 2, (parenthesis_place - value_place - 3));
                    hex_value = parseInt(hex_value, 16);
                }
                break;
            }
            case 1 : // Bin
            {
                var value_place = content.search("0b");
                if (value_place != -1)
                {
                    var hex_value = content.substr(value_place + 2, (parenthesis_place - value_place - 3));
                    while (hex_value.search(" ") != -1)
                    {
                        hex_value = hex_value.replace(" ", "");
                    }
                    hex_value = parseInt(hex_value,2);
                }
                break;
            }
            case 2 : // Décimal
            {
                var value_place = content.search("=");
                if (value_place != -1)
                {
                    var hex_value = content.substr(value_place + 2, (parenthesis_place - value_place - 3));
                    hex_value = parseInt(hex_value, 10);
                }
                break;
            }
        }
    }
    return hex_value;
}//end function get_hex_value

function get_fast_packet_total_byte(pgn_value)
{
    switch (pgn_value)
    {
        case 126208 :
        {
            fast_packet_total_byte = 12;
            fast_packet_repeating_fields = 2;
            break;
        }
        case 126464 :
        {
            fast_packet_total_byte = 4;
            fast_packet_repeating_fields = 1;
            break;
        }
        case 126720 :
        {
            fast_packet_total_byte = 9;
            fast_packet_repeating_fields = 0;
            break;
        }
        case 126985 :
        {
            fast_packet_total_byte = 49;
            fast_packet_repeating_fields = 0;
            break;
        }
        case 126996 :
        {
            fast_packet_total_byte = 0x86;
            fast_packet_repeating_fields = 0;
            break;
        }
        case 126998 :
        {
            fast_packet_total_byte = 8;
            fast_packet_repeating_fields = 0;
            break;
        }
        case 127233 :
        {
            fast_packet_total_byte = 35;
            fast_packet_repeating_fields = 0;
            break;
        }
        case 127237 :
        {
            fast_packet_total_byte = 0x15;
            fast_packet_repeating_fields = 0;
            break;
        }
        case 127489 :
        {
            fast_packet_total_byte = 26;
            fast_packet_repeating_fields = 0;
            break;
        }
        case 127496 :
        {
            fast_packet_total_byte = 14;
            fast_packet_repeating_fields = 0;
            break;
        }
        case 127497 :
        {
            fast_packet_total_byte = 9;
            fast_packet_repeating_fields = 0;
            break;
        }
        case 127498 :
        {
            fast_packet_total_byte = 52;
            fast_packet_repeating_fields = 0;
            break;
        }
        case 127500 :
        {
            fast_packet_total_byte = 10;
            fast_packet_repeating_fields = 0;
            break;
        }
        case 127503 :
        {
            fast_packet_total_byte = 20;
            fast_packet_repeating_fields = 10;
            break;
        }
        case 127510 :
        {
            fast_packet_total_byte = 13;
            fast_packet_repeating_fields = 0;
            break;
        }
        case 127513 :
        {
            fast_packet_total_byte = 10;
            fast_packet_repeating_fields = 0;
            break;
        }
        case 128275 :
        {
            fast_packet_total_byte = 14;
            fast_packet_repeating_fields = 0;
            break;
        }
        case 128520 :
        {
            fast_packet_total_byte = 281;
            fast_packet_repeating_fields = 0;
            break;
        }
        case 129029 :
        {
            fast_packet_total_byte = 51;
            fast_packet_repeating_fields = 3;
            break;
        }
        case 129038 :
        {
            fast_packet_total_byte = 28;
            fast_packet_repeating_fields = 0;
            break;
        }
        case 129039 :
        {
            fast_packet_total_byte = 0x1a;
            fast_packet_repeating_fields = 0;
            break;
        }
        case 129040 :
        {
            fast_packet_total_byte = 54;
            fast_packet_repeating_fields = 0;
            break;
        }
        case 129041 :
        {
            fast_packet_total_byte = 60;
            fast_packet_repeating_fields = 0;
            break;
        }
        case 129044 :
        {
            fast_packet_total_byte = 20;
            fast_packet_repeating_fields = 0;
            break;
        }
        case 129045 :
        {
            fast_packet_total_byte = 40;
            fast_packet_repeating_fields = 0;
            break;
        }
        case 129284 :
        {
            fast_packet_total_byte = 0x22;
            fast_packet_repeating_fields = 0;
            break;
        }
        case 129285 :
        {
            fast_packet_total_byte = 233;
            fast_packet_repeating_fields = 4;
            break;
        }
        case 129540 :
        {
            fast_packet_total_byte = 233;
            fast_packet_repeating_fields = 7;
            break;
        }
        case 129794 :
        {
            fast_packet_total_byte = 75;
            fast_packet_repeating_fields = 0;
            break;
        }
        case 129795 :
        {
            fast_packet_total_byte = 13;
            fast_packet_repeating_fields = 0;
            break;
        }
        case 129796 :
        {
            fast_packet_total_byte = 12;
            fast_packet_repeating_fields = 0;
            break;
        }
        case 129797 :
        {
            fast_packet_total_byte = 233;
            fast_packet_repeating_fields = 0;
            break;
        }
        case 129809 :
        {
            fast_packet_total_byte = 27;
            fast_packet_repeating_fields = 0;
            break;
        }
        case 129810 :
        {
            fast_packet_total_byte = 34;
            fast_packet_repeating_fields = 0;
            break;
        }
        case 130320 :
        {
            fast_packet_total_byte = 20;
            fast_packet_repeating_fields = 0;
            break;
        }
        case 130321 :
        {
            fast_packet_total_byte = 22;
            fast_packet_repeating_fields = 0;
            break;
        }
        case 130567 :
        {
            fast_packet_total_byte = 24;
            fast_packet_repeating_fields = 0;
            break;
        }
        case 130578 :
        {
            fast_packet_total_byte = 12;
            fast_packet_repeating_fields = 0;
            break;
        }
        case 130816 :
        {
            fast_packet_total_byte = 8;
            fast_packet_repeating_fields = 0;
            break;
        }
        default :
        {
            fast_packet_total_byte = -1;
            fast_packet_repeating_fields = -1;
            break;
        }
    }//end switch (pgn)
}//end function fast_packet_total_byte

//------------------------------------------------------------------------------------------------------------------------------------------//
//                                                END NMEA_2000 Usefull Functions                                                           //
//------------------------------------------------------------------------------------------------------------------------------------------//
