/* Protocol meta info:
<NAME> USB (1.5/12 Mbps) </NAME>
<DESCRIPTION>
USB 1.5 and 12 Mbps decoder
</DESCRIPTION>
<VERSION> 0.4 </VERSION>
<AUTHOR_NAME> Hristo Gochkov, Nicolas BASTIT </AUTHOR_NAME>
<AUTHOR_URL> hristo.gochkov@bitsbg.com </AUTHOR_URL>
<HELP_URL> https://github.com/ikalogic/ScanaStudio-scripts-v3/wiki </HELP_URL>
<COPYRIGHT> Copyright Hristo Gochkov </COPYRIGHT>
<LICENSE> This code is distributed under the terms of the GNU General Public License GPLv3 </LICENSE>
<RELEASE_NOTES>
V0.4:  Offers to configure the USB trigger once added (ScanaStudio v6).
V0.3:  Demo signals over the whole capture, built in a few seconds.
V0.2:  Full Speed by default. Demo signals and trigger. The last packet and a remote wakeup are decoded.
V0.1:  Initial release.
</RELEASE_NOTES>
*/


//constants

//USB Bus States
const USB_INVALID = 0;
const USB_DETACH = 1;
const USB_RESET = 2;
const USB_SUSPEND = 3;
const USB_ATTACH = 4;

//USB IO States
const USB_SE0 = 0;
const USB_K = 1;
const USB_J = 2;
const USB_SE1 = 3;

//USB Packet Types
const USB_OUT = 0xE1;
const USB_IN = 0x69;
const USB_SOF = 0xA5;
const USB_SETUP = 0x2D;

const USB_DATA0 = 0xC3;
const USB_DATA1 = 0x4B;
const USB_DATA2 = 0x87;
const USB_MDATA = 0x0F;

const USB_ACK = 0xD2;
const USB_NACK = 0x5A;
const USB_STALL = 0x1E;
const USB_NYET = 0x96;

const USB_ERR_PRE = 0x3C;
const USB_SPLIT = 0x78;
const USB_PING = 0xB4;
const USB_RESERVED = 0xF0;

//Global variables
var sampling_rate = 0;
var one_sample_ns = 0;
var one_bit_samples = 0;
var one_bit_ns = 0;
var half_bit_samples = 0;
var bit_rate = 12000000;
var is_low_speed = false;
var sample_rate_too_low = false;

//GUI variables
var dp = -1;
var dm = -1;

var check_crc = false;
var show_errors = true;
var signal_view = true;
var mark_bits = false;
var hex_view = true;
var packet_view = true;

var mark_io_states = false;
var mark_usb_states = false;

var mark_ep = [true, true, true, true, true, true, true];

var mark_out = true;
var mark_in = true;
var mark_sof = false;
var mark_setup = true;

var mark_ack = true;
var mark_nack = false;
var mark_stall = true;
var mark_nyet = true;

var mark_err_pre = true;
var mark_split = true;
var mark_ping = true;

/*
 * Helper Functions
*/

function print_thousand(t){
  var s = "";
  if(t < 100) s += "0";
  if(t < 10) s += "0";
  return s + t;
}

function print_time(samples){
  var nanos = Math.round((samples * 1000000000) / sampling_rate);
  var micros = Math.floor(nanos / 1000);
  var millis = Math.floor(micros / 1000);
  var seconds = Math.floor(millis / 1000);
  return seconds+"."+print_thousand(millis % 1000)+print_thousand(micros % 1000)+print_thousand(nanos % 1000);
}

function pnHex(x){
  var y = (+x).toString(16).toUpperCase();
  if (y.length % 2 != 0) {
    y = "0" + y;
  }
  return y;
}

function pHex(x){
  return "0x" + pnHex(x);
}

function pHexC(x){
  return pHex(x) + ", ";
}

function get_packet_type(b){
  switch (b) {
    case USB_OUT: return "OUT";
    case USB_IN: return "IN";
    case USB_SOF: return "SOF";
    case USB_SETUP: return "SETUP";

    case USB_DATA0: return "DATA0";
    case USB_DATA1: return "DATA1";
    case USB_DATA2: return "DATA2";
    case USB_MDATA: return "MDATA";

    case USB_ACK: return "ACK";
    case USB_NACK: return "NACK";
    case USB_STALL: return "STALL";
    case USB_NYET: return "NYET";

    case USB_ERR_PRE: return "ERR_PRE";
    case USB_SPLIT: return "SPLIT";
    case USB_PING: return "PING";
    case USB_RESERVED: return "RESERVED";
    default: return pHex(b);
  }
}

function get_packet_show(b){
  switch (b) {
    case USB_OUT: return mark_out;
    case USB_IN: return mark_in;
    case USB_SOF: return mark_sof;
    case USB_SETUP: return mark_setup;

    case USB_ACK: return mark_ack;
    case USB_NACK: return mark_nack;
    case USB_STALL: return mark_stall;
    case USB_NYET: return mark_nyet;

    case USB_ERR_PRE: return mark_err_pre;
    case USB_SPLIT: return mark_split;
    case USB_PING: return mark_ping;
    default: return true;
  }
}
//Error    Red
//Misc     Brown
//Wrap     Orange
//Preamble Yellow
//Check    Green
//Data     Blue
//Head     Purple

function get_packet_color(b){
  switch (b) {
    case USB_OUT:       return ScanaStudio.PacketColors.Preamble.Title;
    case USB_IN:        return ScanaStudio.PacketColors.Data.Title;
    case USB_SOF:       return "#000000";
    case USB_SETUP:     return ScanaStudio.PacketColors.Wrap.Title;

    case USB_DATA0:     return ScanaStudio.PacketColors.Misc.Title;
    case USB_DATA1:     return ScanaStudio.PacketColors.Misc.Title;
    case USB_DATA2:     return ScanaStudio.PacketColors.Misc.Title;
    case USB_MDATA:     return ScanaStudio.PacketColors.Misc.Title;

    case USB_ACK:       return ScanaStudio.PacketColors.Check.Title;
    case USB_NACK:      return ScanaStudio.PacketColors.Error.Title;
    case USB_STALL:     return ScanaStudio.PacketColors.Error.Title;
    case USB_NYET:      return ScanaStudio.PacketColors.Error.Title;

    case USB_ERR_PRE:   return ScanaStudio.PacketColors.Error.Title;
    case USB_SPLIT:     return ScanaStudio.PacketColors.Misc.Title;
    case USB_PING:      return ScanaStudio.PacketColors.Wrap.Title;
    case USB_RESERVED:  return ScanaStudio.PacketColors.Error.Title;

    default:            return "#FF0000";
  }
}

function get_packet_bgcolor(b){
  switch (b) {
    case USB_OUT:       return ScanaStudio.PacketColors.Preamble.Content;
    case USB_IN:        return ScanaStudio.PacketColors.Data.Content;
    case USB_SOF:       return "#333333";
    case USB_SETUP:     return ScanaStudio.PacketColors.Wrap.Content;

    case USB_DATA0:     return ScanaStudio.PacketColors.Misc.Content;
    case USB_DATA1:     return ScanaStudio.PacketColors.Misc.Content;
    case USB_DATA2:     return ScanaStudio.PacketColors.Misc.Content;
    case USB_MDATA:     return ScanaStudio.PacketColors.Misc.Content;

    case USB_ACK:       return ScanaStudio.PacketColors.Check.Content;
    case USB_NACK:      return ScanaStudio.PacketColors.Error.Content;
    case USB_STALL:     return ScanaStudio.PacketColors.Error.Content;
    case USB_NYET:      return ScanaStudio.PacketColors.Error.Content;

    case USB_ERR_PRE:   return ScanaStudio.PacketColors.Error.Content;
    case USB_SPLIT:     return ScanaStudio.PacketColors.Misc.Content;
    case USB_PING:      return ScanaStudio.PacketColors.Wrap.Content;
    case USB_RESERVED:  return ScanaStudio.PacketColors.Error.Content;

    default:            return "#FF0000";
  }
}

/*
 * Settings and Globals
*/

//Show decoder GUI
function on_draw_gui_decoder(){
  ScanaStudio.gui_add_separator("Signals")
    ScanaStudio.gui_add_ch_selector("dp","D+","D+");
    ScanaStudio.gui_add_ch_selector("dm","D-","D-");
    ScanaStudio.gui_add_combo_box("is_low_speed","Select USB Speed");
      ScanaStudio.gui_add_item_to_combo_box("Full Speed (12 Mbps)", true);
      ScanaStudio.gui_add_item_to_combo_box("Low Speed (1.5 Mbps)", false);

  ScanaStudio.gui_add_separator("Options")
    ScanaStudio.gui_add_new_tab("General Display Options", true);
      ScanaStudio.gui_add_check_box("check_crc", "Check CRC", false);
      ScanaStudio.gui_add_check_box("show_errors", "Show Errors", true);
      ScanaStudio.gui_add_check_box("signal_view", "Add to Signal View", true);
      ScanaStudio.gui_add_check_box("mark_bits", "Mark bits in Signal View", false);
      ScanaStudio.gui_add_check_box("hex_view", "Add to Hex View", true);
      ScanaStudio.gui_add_check_box("packet_view", "Add to Packet View", true);
    ScanaStudio.gui_end_tab();

    ScanaStudio.gui_add_new_tab("Low Level Display Options", false);
      ScanaStudio.gui_add_check_box("mark_usb_states", "Show USB States", false);
      ScanaStudio.gui_add_check_box("mark_io_states", "Show IO States", false);
    ScanaStudio.gui_end_tab();

    ScanaStudio.gui_add_new_tab("Filter By Endpoint", false);
      ScanaStudio.gui_add_check_box("mark_ep0", "Show EP0", true);
      ScanaStudio.gui_add_check_box("mark_ep1", "Show EP1", true);
      ScanaStudio.gui_add_check_box("mark_ep2", "Show EP2", true);
      ScanaStudio.gui_add_check_box("mark_ep3", "Show EP3", true);
      ScanaStudio.gui_add_check_box("mark_ep4", "Show EP4", true);
      ScanaStudio.gui_add_check_box("mark_ep5", "Show EP5", true);
      ScanaStudio.gui_add_check_box("mark_ep6", "Show EP6", true);
    ScanaStudio.gui_end_tab();

    ScanaStudio.gui_add_new_tab("Filter By Transaction Type", true);
      ScanaStudio.gui_add_check_box("mark_out", "Decode OUT", true);
      ScanaStudio.gui_add_check_box("mark_in", "Decode IN", true);
      ScanaStudio.gui_add_check_box("mark_sof", "Decode SOF", false);
      ScanaStudio.gui_add_check_box("mark_setup", "Decode SETUP", true);
    ScanaStudio.gui_end_tab();

    ScanaStudio.gui_add_new_tab("Filter By Transaction Result", true);
      ScanaStudio.gui_add_check_box("mark_ack", "Show ACKed", true);
      ScanaStudio.gui_add_check_box("mark_nack", "Show NACKed", false);
      ScanaStudio.gui_add_check_box("mark_stall", "Show STALLed", true);
      ScanaStudio.gui_add_check_box("mark_nyet", "Show NYETed", true);
    ScanaStudio.gui_end_tab();

    ScanaStudio.gui_add_new_tab("Special Transactions", false);
      ScanaStudio.gui_add_check_box("mark_err_pre", "Show ERR_PRE", true);
      ScanaStudio.gui_add_check_box("mark_split", "Show SPLIT", true);
      ScanaStudio.gui_add_check_box("mark_ping", "Show PING", true);
    ScanaStudio.gui_end_tab();
}

//Evaluate decoder GUI
function on_eval_gui_decoder(){
  if (ScanaStudio.gui_get_value("dp") == -1 || ScanaStudio.gui_get_value("dm") == -1) {
      return "Error: D+ and D- must be selected";
  }

  // ScanaStudio v6 offers to configure the USB trigger once the decoder is
  // added; v3 has no such call and would stop this eval on a TypeError.
  if (typeof ScanaStudio.ask_to_add_trigger === "function") {
    ScanaStudio.ask_to_add_trigger();
  }

  return ""; //All good.
}

//Load UI Values from Settings
function init_ui_settings(){
  dp = ScanaStudio.gui_get_value("dp");
  dm = ScanaStudio.gui_get_value("dm");
  
  check_crc = ScanaStudio.gui_get_value("check_crc");
  show_errors = ScanaStudio.gui_get_value("show_errors");
  signal_view = ScanaStudio.gui_get_value("signal_view");
  mark_bits = ScanaStudio.gui_get_value("mark_bits");
  hex_view = ScanaStudio.gui_get_value("hex_view");
  packet_view = ScanaStudio.gui_get_value("packet_view");

  mark_io_states = ScanaStudio.gui_get_value("mark_io_states");
  mark_usb_states = ScanaStudio.gui_get_value("mark_usb_states");

  for (var i = 0; i < 7; i++) {
    mark_ep[i] = ScanaStudio.gui_get_value("mark_ep"+i);
  }

  mark_out = ScanaStudio.gui_get_value("mark_out");
  mark_in = ScanaStudio.gui_get_value("mark_in");
  mark_sof = ScanaStudio.gui_get_value("mark_sof");
  mark_setup = ScanaStudio.gui_get_value("mark_setup");
  
  mark_ack = ScanaStudio.gui_get_value("mark_ack");
  mark_nack = ScanaStudio.gui_get_value("mark_nack");
  mark_stall = ScanaStudio.gui_get_value("mark_stall");
  mark_nyet = ScanaStudio.gui_get_value("mark_nyet");

  mark_err_pre = ScanaStudio.gui_get_value("mark_err_pre");
  mark_split = ScanaStudio.gui_get_value("mark_split");
  mark_ping = ScanaStudio.gui_get_value("mark_ping");
}

//Init Globals
function init_globals(){
  sampling_rate = ScanaStudio.get_capture_sample_rate();
  is_low_speed = ScanaStudio.gui_get_value("is_low_speed");
  if(is_low_speed){
    bit_rate = 1500000;
  }
  one_bit_samples = sampling_rate / bit_rate;
  half_bit_samples = one_bit_samples / 2;
  one_sample_ns = 1000000000 / sampling_rate;
  one_bit_ns = 1000000000 / bit_rate;
  ScanaStudio.console_info_msg("Sample rate is " + (sampling_rate / 1000000) + " MHz.");
  ScanaStudio.console_info_msg("Bit rate is " + (bit_rate / 1000000) + " MHz.");
  if(sampling_rate < (3 * bit_rate)){
    ScanaStudio.console_error_msg("Sample rate is too low! Minimum is: "+(bit_rate * 3 / 1000000)+" Mhz");
    sample_rate_too_low = true;
  }
}

/*
 * Add Transactions And Packets
*/

function print_packet_data(data, len, index){
  var data_index = 0;
  var sub_index = 0;
  while(len >= 8){
    var str = "";
    for (var i = 0; i < 8; i++) {
      var d = data[data_index++];
      str += pnHex(d)+" "
    }
    ScanaStudio.packet_view_add_packet(false, dm, index+(sub_index++), index+sub_index, "DATA ["+(data_index-8)+"-"+(data_index-1)+"]", str, "#000000", "#333333");
    len -= 8;
  }
  if(len){  
    var str = "";
    for (var i = 0; i < len; i++) {
      var d = data[data_index++];
      str += pnHex(d)+" "
    }
    ScanaStudio.packet_view_add_packet(false, dm, index+(sub_index++), index+sub_index, "DATA ["+(data_index-len)+"-"+(data_index-1)+"]", str, "#000000", "#333333");
  }
}

function print_packet(packet, is_error){
  var ptype = get_packet_type(packet.type);
  var p_start = packet.data[0][1];
  var p_end = packet.data[packet.len-1][2];
  var p_title = print_time(p_start)+" "+ptype;
  var p_description = "";
  var p_color = get_packet_color(packet.type);
  var p_bgcolor = packet.crc?get_packet_bgcolor(packet.type):ScanaStudio.PacketColors.Error.Content;

  if(packet.type == USB_SOF){
    if(packet.len > 4){
      p_title = "*"+p_title
    }
    var frame_num = packet.data[2][0] | ((packet.data[3][0] & 0x07) << 8);
    var crc = (packet.data[3][0] >> 3);
    p_description = "Frame:"+frame_num+", CRC5:"+pHex(crc);
  } else if(packet.type == USB_IN || packet.type == USB_OUT || packet.type == USB_SETUP || packet.type == USB_PING){
    if(packet.len > 4){
      p_title = "*"+p_title
    }
    var address = packet.data[2][0] & 0x7F;
    var ep = (packet.data[2][0] >> 7) + ((packet.data[3][0] & 7) * 2);
    var crc = (packet.data[3][0] >> 3);
    p_description = "ADDR:"+address+", EP:"+ep+", CRC5:"+pHex(crc);
  } else if(packet.type == USB_DATA0 || packet.type == USB_DATA1){
    var dlen = packet.len-4;
    p_description = "LEN:"+dlen;
    for(var b=0; b<dlen; b++){
      var d = packet.data[b+2];
      if(hex_view && !is_error){
        ScanaStudio.hex_view_add_byte(dm, d[1], d[2], d[0]);
      }
    }
    var crc = (packet.data[packet.len-1][0] << 8) | packet.data[packet.len-2][0];
    p_description += ", CRC16:"+pHex(crc);
  } else if(packet.type != USB_ACK && packet.type != USB_NACK && packet.type != USB_NYET){
    var dlen = packet.len-2;
    p_description = "["+dlen+"]";
    for(var b=0; b<dlen; b++){
      p_description += " "+pnHex(packet.data[b+2][0]);
    }
  }
  if(!packet.crc){
    p_description += " FAIL";
  }

  if(is_error || signal_view){
    for(var i=0; i<packet.len; i++){
      var pv = packet.data[i][0];
      var ps = packet.data[i][1];
      var pe = packet.data[i][2];
      ScanaStudio.dec_item_new(dm, ps, pe);
      if(i == 0){
        ScanaStudio.dec_item_add_content("SYNC: "+pHex(pv));
      } else if(i == 1){
        ScanaStudio.dec_item_add_content(ptype+": "+pHex(pv));
      }
      ScanaStudio.dec_item_add_content(pHex(pv));
      if(mark_bits || is_error){
        for(j=0; j<8; j++){
          ScanaStudio.dec_item_add_sample_point(ps + half_bit_samples + (j * one_bit_samples),((pv & (1 << j)) != 0)?"1":"0");
        }
      }
      if(is_error){
        ScanaStudio.dec_item_emphasize_error();
      }
      ScanaStudio.dec_item_end();
    }
  }

  if(packet_view){
    ScanaStudio.packet_view_add_packet(false, dm, p_start, p_end, p_title, p_description, p_color, p_bgcolor);
  }
}

function print_transaction(type, etype, len, start, end, packets, is_error){
  if(packet_view || is_error){
    var t_title = print_time(start)+" "+get_packet_type(type);
    var t_description = "";
    var t_color = is_error?ScanaStudio.PacketColors.Error.Title:get_packet_color(type);
    var t_bgcolor = is_error?ScanaStudio.PacketColors.Error.Content:get_packet_bgcolor(type);
    var dlen = ((len > 2)?(packets[1].len - 4):0);

    if(type == USB_SOF){
      var pdata = packets[0].data;
      if(packets[0].len > 4){
        t_title = "*"+t_title
      }
      var frame_num = pdata[2][0] | ((pdata[3][0] & 0x07) << 8);
      t_description = "Frame:"+frame_num;
    } else {
      if(type == USB_IN || type == USB_OUT || type == USB_SETUP || type == USB_PING){
        var pdata = packets[0].data;
        if(packets[0].len > 4){
          t_title = "*"+t_title
        }
        var address = pdata[2][0] & 0x7F;
        var ep = ((pdata[2][0] >> 7) & 1) | ((pdata[3][0] & 7) << 1);

        if(!is_error && ep < 7 && !mark_ep[ep]){
          return;
        }
        t_description = "ADDR:"+address+", EP:"+ep+", LEN:"+dlen;

        if(etype == USB_ACK || etype == USB_NACK || etype == USB_NYET){
          t_description += ", "+get_packet_type(etype);
        } else {
          t_description += ", INCOMPLETE";
        }
      } else {
        t_description = "NOT IN TRANSACTION";
      }
    }
    ScanaStudio.packet_view_add_packet(true, dm, start, end, t_title, t_description, t_color, t_bgcolor);
    if(type == USB_SETUP && dlen == 8){
      var req = [];
      for (var i = 0; i < 8; i++) {
        req.push(packets[1].data[i+2][0]);
      }
      var start_index = packets[1].data[packets[1].len-1][2];
      print_packet_data(req, dlen, start_index);
      parse_stdrequest(req, start_index+1);
    } else if(dlen > 0 && (type == USB_IN || type == USB_OUT)){
      var req = [];
      for (var i = 0; i < dlen; i++) {
        req.push(packets[1].data[i+2][0]);
      }
      print_packet_data(req, dlen, packets[1].data[packets[1].len-1][2]);
    }
  }
  for (var i = 0; i < len; i++) {
    print_packet(packets[i], is_error);
  }
}

/*
 * Filter Transactions
*/

function handle_transaction(tr){
  var tr_type = tr[0].type;

  var tr_len = tr.length;
  var tr_start = tr[0].data[0][1];
  var tr_end = tr[tr_len - 1].data[tr[tr_len - 1].len - 1][2];
  var tr_etype = tr[tr_len - 1].type;
  
  var tr_success = (tr_len > 1 && tr_etype == USB_ACK);
  var tr_nack = (tr_len > 1 && tr_etype == USB_NACK);
  var tr_nyet = (tr_len > 1 && tr_etype == USB_NYET);
  var tr_empty = (tr_type == USB_SOF)||tr_nack||tr_nyet;
  var tr_crc = true;
  for (var i = 0; i < tr_len; i++) {
    if(!tr[i].crc){
      tr_crc = false;
      break;
    }
  }

  if(tr_success && tr_crc){
    if(mark_ack && get_packet_show(tr_type)){
      print_transaction(tr_type, tr_etype, tr_len, tr_start, tr_end, tr, false);
    }
  } else if(!tr_crc || (!tr_success && !tr_empty)){
    //error
    if(show_errors){
      print_transaction(tr_type, tr_etype, tr_len, tr_start, tr_end, tr, true);
    }
  } else if(get_packet_show(tr_type)){
    //empty skippable packet
    if((mark_sof && tr_type == USB_SOF) || (mark_nack && tr_etype == USB_NACK) || (mark_nyet && tr_etype == USB_NYET)){
      print_transaction(tr_type, tr_etype, tr_len, tr_start, tr_end, tr, false);
    }
  }
}


/*
 * Check Packet CRC
*/

function _calculate_crc(len, data_bits){
  var poly_data = new Array(1,1,0,0,0,0,0,0,0,0,0,0,0,0,1,0,1);
  var poly_token = new Array(1,0,0,1,0,1);
  var j;
  var bit_index = 0;
  var remainder = false;
  var end = false;
  var crc_len = 5;
  var crc = 0;
  
  if(len == 11) {
    crc_len = 5;
  } else { 
    crc_len = 16;
  }
  if(len != 0){
    for(j=0; j<crc_len; j++) {
      data_bits[j] ^= 1;
      data_bits[j+len] = 0;  
    }   
    while (remainder == false) {
      while((data_bits[bit_index] == 0) && (end == false)) {
        bit_index++;
        if (bit_index == len) {
          end = true;
        } 
      }
      if(bit_index < len) { 
        for(j=0; j<(crc_len+1); j++) {
          if(len == 11) {
            data_bits[bit_index+j] ^= poly_token[j];
          } else {
            data_bits[bit_index+j] ^= poly_data[j];
          }
        }
        bit_index++;
      } else {
        remainder = true;
      }
    }
    for (j=0; j<crc_len; j++) {
      data_bits[len+j] ^= 1; 
      crc |= data_bits[len+j]<<j;
    }
  } else {
    crc = 0; 
  } 
  return crc;
}

function check_packet_crc(packet){
  var ccrc = 0;
  var crc = 0;
  var tab_data_crc = [];
  if(packet.type == USB_SOF || packet.type == USB_IN || packet.type == USB_OUT || packet.type == USB_SETUP || packet.type == USB_PING){
    var data = packet.data[2][0] | ((packet.data[3][0] & 0x07) << 8);
    crc = (packet.data[3][0] >> 3);
    for (var i = 0; i < 11; i++) {
      tab_data_crc[i] = (data >> i) & 1;
    }
    ccrc = _calculate_crc(11, tab_data_crc);
  } else if(packet.type == USB_DATA0 || packet.type == USB_DATA1){
    crc = (packet.data[packet.len-1][0] << 8) | packet.data[packet.len-2][0];
    var dlen = packet.len-4;
    var bit = 0;
    for (var i = 0; i < dlen; i++) {
      var d = packet.data[i+2][0];
      for (var j = 0; j < 8; j++) {
        tab_data_crc[bit++] = (d >> j) & 1;
      }
    }
    ccrc = _calculate_crc(8 * dlen, tab_data_crc);
  }
  return (crc == ccrc);
}

/*
 * Collect Packets Into Transactions
*/

var in_transaction = false;
var transaction_packets = [];

function handle_packet(data, bytes){
  var ptype = data[1][0];
  var packet = {type:ptype,data:data,len:bytes};
  packet.crc = check_crc?check_packet_crc(packet):true;

  if(ptype == USB_OUT || ptype == USB_IN || ptype == USB_SOF || ptype == USB_SETUP || ptype == USB_PING){
    //transaction start
    if(in_transaction){
      //we got no response
      handle_transaction(transaction_packets);
    }
    in_transaction = true;
    transaction_packets = [packet];
  } else if(ptype == USB_ACK || ptype == USB_NACK || ptype == USB_STALL || ptype == USB_NYET){
    //transaction end
    if(in_transaction){
      transaction_packets.push(packet);
      handle_transaction(transaction_packets);
      in_transaction = false;
    } else {
      //no transaction started?
      handle_transaction([packet]);
    }
  } else if(ptype == USB_DATA0 || ptype == USB_DATA1 || ptype == USB_DATA2 || ptype == USB_MDATA){
    //transaction data
    if(in_transaction){
      transaction_packets.push(packet);
    } else {
      //no transaction started?
      handle_transaction([packet]);
    }
  } else if(ptype == USB_ERR_PRE){
    //err/prepend depends on transaction state
    if(in_transaction){
      transaction_packets.push(packet);
      handle_transaction(transaction_packets);
      in_transaction = false;
    } else {
      in_transaction = true;
      transaction_packets = [packet];
    }
  } else {
    //split/reserved (temporary!!! remove/change)
    if(in_transaction){
      transaction_packets.push(packet);
      handle_transaction(transaction_packets);
      in_transaction = false;
    } else {
      handle_transaction([packet]);
    }
  }
}

/*
 * USB BUS State and Packet Builder
*/

//Detach: SE0 more than 2 bit times
//Reset: host sets SE0 for at least 10ms
//Suspend: no activity from the host for 3ms
//Resume: host switches to K state for at least 20ms
//EOP/KeepAlive: SE0 for 2 bit times, followed by 1 bit J
//SOP: data lines switch from IDLE to K
var bus_states = ['INVALID','DETACH','RESET','SUSPEND','ATTACH'];
//var io_states = ['SE0', 'K', 'J', 'SE1'];

var bus_state = USB_INVALID;
var bus_state_since = 0;

function set_bus_sate(state, index){
  if(mark_usb_states){
    var title = print_time(index)+" "+bus_states[state];
    var description = bus_states[bus_state]+" -> "+bus_states[state];
    ScanaStudio.packet_view_add_packet(true, dp, index - half_bit_samples , index + half_bit_samples, 
      title, description, 
      (state == USB_INVALID)?"#FF7F7F":"#7F7FFF",(state == USB_INVALID)?"#FF9F9F":"#9F9FFF");
    if(!mark_io_states){
      ScanaStudio.dec_item_new(dp, index-half_bit_samples, index+half_bit_samples);
      ScanaStudio.dec_item_add_content(bus_states[state]);
      if(state == USB_INVALID){
        ScanaStudio.dec_item_emphasize_error();
      }
      ScanaStudio.dec_item_end();
    }
  }
  bus_state = state;
  bus_state_since = index;
}

var in_packet = false;
var packet_started_at = 0;
var packet_byte_at = 0;
var packet_byte = 0;
var packet_bytes = 0;
var packet_bit = 0;
var packet_data = [];

//end of packet detected 
function handle_packet_end(pin_state, bits, nanosec, index, samples){
  if(mark_io_states){
    ScanaStudio.dec_item_new(dp, index, index + samples);
    ScanaStudio.dec_item_add_content("EOP");
    ScanaStudio.dec_item_end();
  }
  if(packet_bytes > 1){
    handle_packet(packet_data, packet_bytes);
  } else {
    if(in_transaction){
      handle_transaction(transaction_packets);
      in_transaction = false;
    }
    if(show_errors){
      ScanaStudio.dec_item_new(dm, packet_started_at, index + samples);
      ScanaStudio.dec_item_add_content("TOO SHORT: "+packet_bytes);
      ScanaStudio.dec_item_add_content("ERROR");
      ScanaStudio.dec_item_emphasize_error();
      ScanaStudio.dec_item_end();
      ScanaStudio.packet_view_add_packet(true, dm, packet_started_at, index + samples, 
        print_time(index)+" ERROR", "TOO SHORT: "+packet_bytes, 
        ScanaStudio.PacketColors.Error.Title, ScanaStudio.PacketColors.Error.Content);
    }
  }
}

//start a new packet
function handle_packet_start(pin_state, bits, nanosec, index, samples){
  packet_started_at = index;
  packet_byte_at = 0;
  packet_byte = 0;
  packet_bytes = 0;
  packet_bit = 0;
  packet_data = [];
  if(mark_io_states){
    ScanaStudio.dec_item_new(dp, index - one_bit_samples, index);
    ScanaStudio.dec_item_add_content("SOP");
    ScanaStudio.dec_item_end();
  }
}

//add bit to the packet
var bit_stuffing = 0;
function handle_packet_bit(v, index, samples, left_samples){
  if(!v && bit_stuffing == 6){
    bit_stuffing = 0;
    if(mark_io_states){
      ScanaStudio.dec_item_new(dp, index, index+samples);
      ScanaStudio.dec_item_add_content("X");
      ScanaStudio.dec_item_end();
    }
    return;//skip this bit
  }
  if(v){
    bit_stuffing++;
  } else {
    bit_stuffing = 0;
  }
  if(bit_stuffing >= 7){
    //we got more 1 bits than we should have!
    if(in_transaction){
      handle_transaction(transaction_packets);
    }
    if(show_errors){
      ScanaStudio.dec_item_new(dm, index, index+samples);
      ScanaStudio.dec_item_add_content("BIT STUFF ERR");
      ScanaStudio.dec_item_emphasize_error();
      ScanaStudio.dec_item_end();
      ScanaStudio.packet_view_add_packet(!in_transaction, dm, packet_started_at, index + samples, 
        print_time(index)+" ERROR", "BIT STUFFING", 
        ScanaStudio.PacketColors.Error.Title, ScanaStudio.PacketColors.Error.Content);
    }
    if(left_samples < 128){
      set_bus_sate(USB_INVALID, index);
    }
    packet_byte = 0;
    packet_bit = 0;
    in_packet = false;
    in_transaction = false;
    return;
  }
  if(mark_io_states){
    ScanaStudio.dec_item_new(dp, index, index+samples);
    ScanaStudio.dec_item_add_content(""+v);
    ScanaStudio.dec_item_end();
  }
  if(packet_bit == 0){
    packet_byte_at = index;
  }
  packet_byte |= (v << packet_bit++);
  if(packet_bit == 8){
    if(packet_bytes == 0 && packet_byte != 0x80){
      //attempt to repair missing sync bits
      if((packet_byte & 0x7F) == 0x40){
        packet_byte = (packet_byte & 0x80) >> 7;
        packet_bit = 1;
        packet_data[packet_bytes++] = [0x80, packet_byte_at-samples, index-samples];
        packet_byte_at = index-samples;
        return;
      } else if((packet_byte & 0x3F) == 0x20){
        packet_byte = (packet_byte & 0xC0) >> 6;
        packet_bit = 2;
        packet_data[packet_bytes++] = [0x80, packet_byte_at-(2*samples), index-(2*samples)];
        packet_byte_at = index-(2*samples);
        return;
      }

      if(in_transaction){
        handle_transaction(transaction_packets);
      }
      if(show_errors){
        ScanaStudio.dec_item_new(dm, packet_started_at, index + samples);
        ScanaStudio.dec_item_add_content("SYNC "+pHex(packet_byte));
        ScanaStudio.dec_item_emphasize_error();
        ScanaStudio.dec_item_end();
        ScanaStudio.packet_view_add_packet(!in_transaction, dm, packet_started_at, index + samples, 
          print_time(index)+" SYNC", "SYNC INVALID: "+pHex(packet_byte), 
          ScanaStudio.PacketColors.Error.Title, ScanaStudio.PacketColors.Error.Content);
      }
      if(left_samples < 128){
        set_bus_sate(USB_INVALID, index);
      }
      in_packet = false;
      in_transaction = false;
    } else {
      packet_data[packet_bytes++] = [packet_byte, packet_byte_at, index+samples];
    }
    packet_byte = 0;
    packet_bit = 0;
  }
}

//packet ended prematurely
function handle_packet_fail(pin_state, bits, nanosec, index, samples){
  if(in_transaction){
    handle_transaction(transaction_packets);
    in_transaction = false;
  }
  if(show_errors){
    ScanaStudio.dec_item_new(dm, packet_started_at, index + samples);
    ScanaStudio.dec_item_add_content("ERR EARLY END");
    ScanaStudio.dec_item_add_content("ERROR");
    ScanaStudio.dec_item_emphasize_error();
    ScanaStudio.dec_item_end();

    ScanaStudio.packet_view_add_packet(true, dm, packet_started_at, index + samples, 
      print_time(index)+" ERROR", "EARLY END: S:"+pin_state+", B:"+bits, 
      ScanaStudio.PacketColors.Error.Title, ScanaStudio.PacketColors.Error.Content);
  }
}

//track and detect bus state changes and start/end of packets
var last_state = null;

function handle_state(pin_state, bits, nanosec, index, samples, next_state){

  //if change is too short, then skip.
  //That would cause the next state to be the same as the one before, so skip that one too.
  if(samples < half_bit_samples || (last_state != null && pin_state == last_state[0])){
    return;
  }

  if(bus_state <= USB_RESET){
    if((pin_state == USB_J && bits > 120) || (last_state != null && last_state[0] == USB_SE0 && pin_state == USB_J && bits > 1)){
      //ScanaStudio.console_info_msg("ATTACHED at "+index);
      set_bus_sate(USB_ATTACH, index);
    }
  } else if(bus_state == USB_ATTACH){
    if(!in_packet && last_state[0] == USB_J && pin_state == USB_K && last_state[1] > 1){
      //starting packet
      in_packet = true;
      handle_packet_start(pin_state, bits, nanosec, index, samples);
    }
    var is_eop = (last_state != null && last_state[0] == USB_SE0 && last_state[1] == 2 && pin_state == USB_J && bits > 1);
    if(in_packet){
      //the idle J after an EOP may last any time: the EOP is checked first
      if(!is_eop && (pin_state == USB_SE1 || (pin_state == USB_SE0 && bits > 2) || (pin_state == USB_J && nanosec > 3000000))){
        //packet fail
        //ScanaStudio.console_info_msg("(pin_state == USB_SE1):"+(pin_state == USB_SE1)+", (pin_state == USB_SE0 && bits > 2):"+(pin_state == USB_SE0 && bits > 2)+", (pin_state == USB_J && nanosec > 3000000):"+(pin_state == USB_J && nanosec > 3000000));
        handle_packet_fail(pin_state, bits, nanosec, index, samples);//one_bit_samples);
        in_packet = false;
      } else {
        //valid packet state
        if(is_eop){
          //EOP
          in_packet = false;
          handle_packet_end(pin_state, 1, one_bit_ns, last_state[3], last_state[4]+one_bit_samples);
          //handle the rest of the bits (idle/suspend)
          handle_state(pin_state, bits-1, nanosec-one_bit_ns, index+one_bit_samples, samples - one_bit_samples);
        } else if(pin_state == USB_SE0 && bits == 2){
          //Start EOP: ends the packet as soon as J follows, so the last packet of a capture shows too
          if(next_state == USB_J){
            in_packet = false;
            handle_packet_end(USB_J, 1, one_bit_ns, index, samples + one_bit_samples);
            last_state = [pin_state, bits, nanosec, index, samples];
            return;
          }
        } else {
          //add bits
          handle_packet_bit(0, index, (bits==1)?samples:one_bit_samples, (bits==1)?0:samples-one_bit_samples);
          for(var i=1; i<bits; i++){
            if(!in_packet){
              break;
            }
            handle_packet_bit(1, index + (i * one_bit_samples), (i == (bits-1))?(samples - (i * one_bit_samples)):one_bit_samples, samples - ((i+1) * one_bit_samples));
          }
        }
      }
    }
    if(!in_packet){
      if(pin_state == USB_J && nanosec > 3000000){
        //ScanaStudio.console_info_msg("SUSPEND at "+index);
        set_bus_sate(USB_SUSPEND, index);
      } else if(pin_state == USB_SE0 && nanosec > 10000000){
        //ScanaStudio.console_info_msg("RESET at "+index);
        set_bus_sate(USB_RESET, index);
      } else if(pin_state == USB_SE0 && samples > ((5*is_low_speed)*half_bit_samples)){
        //ScanaStudio.console_info_msg("DETACH at "+index);
        set_bus_sate(USB_DETACH, index);
      } else if(pin_state == USB_SE1){
        //ScanaStudio.console_info_msg("INVALID at "+index);
        set_bus_sate(USB_INVALID, index);
      } else if(pin_state == USB_SE0 && is_low_speed){
        //SOF!
        if(mark_sof){
          if(packet_view){
            ScanaStudio.packet_view_add_packet(true, dm, index, index+samples, "SOF", "", get_packet_color(USB_SOF), get_packet_bgcolor(USB_SOF));
          }
          if(signal_view){
            ScanaStudio.dec_item_new(dm, index, index+samples);
            ScanaStudio.dec_item_add_content("SOF");
            ScanaStudio.dec_item_end();
          }
        }
      }
    }
  } else if(bus_state == USB_SUSPEND){
      //a host resumes with 20 ms of K, a device's remote wakeup lasts 1 to 15 ms
      if(pin_state == USB_K && nanosec > 1000000){
        //ScanaStudio.console_info_msg("RESUMED at "+index);
        set_bus_sate(USB_ATTACH, index);
      } else if(pin_state == USB_SE0){
        set_bus_sate(USB_RESET, index);
      }
  }
  last_state = [pin_state, bits, nanosec, index, samples];
}

/*
 * Convert IO Change To USB IO State and duration
*/

var last_change = [0,0,0];//index, d+, d-

function handle_change(index, dpl, dml){
  var samples = index - last_change[0];
  var nanosec = samples * one_sample_ns;
  var bits = Math.round(samples / one_bit_samples);
  var pin_state = (last_change[1] * 2) + last_change[2];
  var next_state = (dpl * 2) + dml;
  if(is_low_speed){
    pin_state = (last_change[2] * 2) + last_change[1];
    next_state = (dml * 2) + dpl;
  }
  handle_state(pin_state, bits, nanosec, last_change[0], samples, next_state);
  last_change = [index, dpl, dml];
}

/*
 * Core IO Change Detection
*/

var dp_level = 0;
var dp_index = 0;
var dp_trs = null;
var dm_level = 0;
var dm_index = 0;
var dm_trs = null;

var lines_started = false;
var dp_done = false; //the current D+ edge is already handled

function on_decode_signals(resume){
  if (!resume){ //If resume == false, it's the first call to this function.
      sample_rate_too_low = false;
      init_ui_settings();
      init_globals();
      bus_state = USB_INVALID;
      last_state = null;
      in_transaction = false;
      transaction_packets = [];
      bit_stuffing = 0;
      in_packet = false;
      lines_started = false;
      dp_done = false;
  }
  if(sample_rate_too_low){
    return;
  }
  if(!lines_started){
      //reset the trs iterators
      ScanaStudio.trs_reset(dp);
      ScanaStudio.trs_reset(dm);

      dp_trs = ScanaStudio.trs_get_next(dp);
      dm_trs = ScanaStudio.trs_get_next(dm);
      //A line that holds no transition yet reads as neither 0 nor 1 (ScanaStudio 3): wait for it
      if((dp_trs.value > 1) || (dm_trs.value > 1)){
        return;
      }
      lines_started = true;
      dp_level = dp_trs.value;
      dp_index = dp_trs.sample_index;
      dm_level = dm_trs.value;
      dm_index = dm_trs.sample_index;
      last_change = [dp_index, dp_level, dm_level];
  }

  while (ScanaStudio.abort_is_requested() == false) {
    //maybe we got new samples for dm and we do not need to update dp yet
    if(dm_trs.sample_index >= (dp_trs.sample_index - half_bit_samples)){
      if(!ScanaStudio.trs_is_not_last(dp)){
        break;
      }
      dp_trs = ScanaStudio.trs_get_next(dp);
      dp_done = false;
    }

    //check if dm is behind dp
    while(dm_trs.sample_index < (dp_trs.sample_index - half_bit_samples)){
      dm_level = dm_trs.value;
      dm_index = dm_trs.sample_index;
      if(!ScanaStudio.trs_is_not_last(dm)){
        //D- is quiet: once the data goes past this D+ edge, no D- edge can come with it
        if(!dp_done && (ScanaStudio.get_available_samples(dm) > (dp_trs.sample_index + half_bit_samples))){
          handle_change(dp_trs.sample_index, dp_trs.value, dm_level);
          dp_done = true;
        }
        dp_level = dp_trs.value;
        dp_index = dp_trs.sample_index;
        if(!dp_done || !ScanaStudio.trs_is_not_last(dp)){
          return;
        }
        dp_trs = ScanaStudio.trs_get_next(dp);
        dp_done = false;
        continue;
      }
      dm_trs = ScanaStudio.trs_get_next(dm);
      //still behind? handle the change then
      if(dm_trs.sample_index < (dp_trs.sample_index - half_bit_samples)){
        handle_change(dm_trs.sample_index, dp_level, dm_trs.value);
      }
    }

    if((dm_trs.sample_index >= (dp_trs.sample_index - half_bit_samples)) && (dm_trs.sample_index <= (dp_trs.sample_index + half_bit_samples))){
      //we got edge
      if(!dp_done){
        handle_change(dp_trs.sample_index, dp_trs.value, dm_trs.value);
      }
    } else if(dm_trs.sample_index > (dp_trs.sample_index + half_bit_samples)){
      //dm is ahead
      if(!dp_done){ //else it was handled while D- was quiet
        handle_change(dp_trs.sample_index, dp_trs.value, dm_level);
      }

      if(is_low_speed){
        handle_change(dm_trs.sample_index, dp_trs.value, dm_trs.value);
      }
    }
    dp_level = dp_trs.value;
    dp_index = dp_trs.sample_index;
  }
}

/*
 * Trigger
 * The bits of SYNC, PID and of a token are known in advance: the trigger follows their
 * NRZI edges on the line that is high in the J state (D+ at full speed, D- at low speed),
 * each edge one or more bit times after the previous one, give or take half a bit.
*/

const TRIG_RESET = 0;
const TRIG_SOP = 1;
const TRIG_EOP = 2;
const TRIG_SUSPEND = 3;
const TRIG_RESUME = 4;
const TRIG_TOKEN = 5;
const TRIG_DATA_HANDSHAKE = 6;
const TRIG_TOKEN_ADDRESS = 7;
const TRIG_SOF_FRAME = 8;

const TRIG_TOKEN_PIDS = [USB_SETUP, USB_IN, USB_OUT, USB_SOF];
const TRIG_TOKEN_NAMES = ["SETUP", "IN", "OUT", "SOF"];
const TRIG_DATA_PIDS = [USB_DATA0, USB_DATA1, USB_ACK, USB_NACK, USB_STALL];
const TRIG_DATA_NAMES = ["DATA0", "DATA1", "ACK", "NAK", "STALL"];

//Trigger sequence GUI
function on_draw_gui_trigger(){
  ScanaStudio.gui_add_new_selectable_containers_group("trig_type", "Trigger on");
    ScanaStudio.gui_add_new_container("Bus reset (SE0 for more than 2.5 us, triggers when it ends)", true);
    ScanaStudio.gui_end_container();
    ScanaStudio.gui_add_new_container("Start of any packet (SYNC)", false);
    ScanaStudio.gui_end_container();
    ScanaStudio.gui_add_new_container("End of any packet (EOP)", false);
    ScanaStudio.gui_end_container();
    ScanaStudio.gui_add_new_container("End of a suspend (bus idle for more than 3 ms)", false);
    ScanaStudio.gui_end_container();
    ScanaStudio.gui_add_new_container("Resume (K state for more than 1 ms, triggers when it ends)", false);
    ScanaStudio.gui_end_container();
    ScanaStudio.gui_add_new_container("Token packet", false);
      ScanaStudio.gui_add_combo_box("trig_token_pid", "PID");
      for (var i = 0; i < TRIG_TOKEN_NAMES.length; i++) {
        ScanaStudio.gui_add_item_to_combo_box(TRIG_TOKEN_NAMES[i], i == 0);
      }
    ScanaStudio.gui_end_container();
    ScanaStudio.gui_add_new_container("Data or handshake packet", false);
      ScanaStudio.gui_add_combo_box("trig_data_pid", "PID");
      for (var i = 0; i < TRIG_DATA_NAMES.length; i++) {
        ScanaStudio.gui_add_item_to_combo_box(TRIG_DATA_NAMES[i], i == 0);
      }
    ScanaStudio.gui_end_container();
    ScanaStudio.gui_add_new_container("Token to a device address and endpoint", false);
      ScanaStudio.gui_add_combo_box("trig_addr_pid", "PID");
      for (var i = 0; i < 3; i++) {
        ScanaStudio.gui_add_item_to_combo_box(TRIG_TOKEN_NAMES[i], i == 0);
      }
      ScanaStudio.gui_add_text_input("trig_address", "Device address (0 to 127)", "0");
      ScanaStudio.gui_add_text_input("trig_endpoint", "Endpoint (0 to 15)", "0");
    ScanaStudio.gui_end_container();
    ScanaStudio.gui_add_new_container("SOF with a frame number", false);
      ScanaStudio.gui_add_text_input("trig_frame", "Frame number (0 to 2047)", "0");
    ScanaStudio.gui_end_container();
  ScanaStudio.gui_end_selectable_containers_group();
}

//Evaluate trigger GUI
function on_eval_gui_trigger(){
  var type = Number(ScanaStudio.gui_get_value("trig_type"));
  if (type == TRIG_TOKEN_ADDRESS) {
    if (isNaN(trig_integer("trig_address", 127))) {
      return "The device address must be an integer between 0 and 127";
    }
    if (isNaN(trig_integer("trig_endpoint", 15))) {
      return "The endpoint must be an integer between 0 and 15";
    }
  }
  else if (type == TRIG_SOF_FRAME) {
    if (isNaN(trig_integer("trig_frame", 2047))) {
      return "The frame number must be an integer between 0 and 2047";
    }
  }
  return ""; //All good.
}

//The value of a text field, NaN unless it is an integer between 0 and max (decimal, or hex with 0x)
function trig_integer(id, max){
  var text = String(ScanaStudio.gui_get_value(id)).trim();
  var value = (text == "") ? NaN : Number(text);
  if (isNaN(value) || (value < 0) || (value > max) || (Math.floor(value) != value)) {
    return NaN;
  }
  return value;
}

//Build trigger sequence
function on_build_trigger(){
  dp = ScanaStudio.gui_get_value("dp");
  dm = ScanaStudio.gui_get_value("dm");
  var low_speed = (ScanaStudio.gui_get_value("is_low_speed") == 1);
  var trig = {
    j_line: low_speed ? dm : dp, //the line that is high in the J state
    k_line: low_speed ? dp : dm,
    bit: 1 / (low_speed ? 1500000 : 12000000)
  };
  var type = Number(ScanaStudio.gui_get_value("trig_type"));
  var steps = [];

  if (type == TRIG_RESET) {
    //inside traffic the J line stays low at most 7 K bits + 2 SE0 bits: 6 us at low speed
    steps.push({ j: "F" });
    steps.push({ j: "R", k: "0", t_min: Math.max(2.5e-6, 10 * trig.bit) });
  }
  else if (type == TRIG_SOP) {
    steps = trig_packet_steps(usb_bits_lsb_first(0x80, 8), false);
    //SYNC ends on K; whatever the PID, the next edge comes 2 to 6 bits later
    steps.push({ j: "R", t_min: 1.5 * trig.bit, t_max: 6.5 * trig.bit });
  }
  else if (type == TRIG_EOP) {
    //J line low for the 2 SE0 bits (and the K bits before them), then up while the K line stays low
    steps.push({ j: "F" });
    steps.push({ j: "R", k: "0", t_min: 1.5 * trig.bit, t_max: 10 * trig.bit });
  }
  else if (type == TRIG_SUSPEND) {
    steps.push({ j: "R" });
    steps.push({ j: "F", t_min: 3e-3 });
  }
  else if (type == TRIG_RESUME) {
    steps.push({ k: "R" });
    steps.push({ k: "F", t_min: 1e-3 });
  }
  else if (type == TRIG_TOKEN) {
    var pid = TRIG_TOKEN_PIDS[ScanaStudio.gui_get_value("trig_token_pid")];
    steps = trig_packet_steps(usb_bits_lsb_first(0x80, 8).concat(usb_bits_lsb_first(pid, 8)), false);
  }
  else if (type == TRIG_DATA_HANDSHAKE) {
    var pid = TRIG_DATA_PIDS[ScanaStudio.gui_get_value("trig_data_pid")];
    var handshake = (pid == USB_ACK) || (pid == USB_NACK) || (pid == USB_STALL);
    steps = trig_packet_steps(usb_bits_lsb_first(0x80, 8).concat(usb_bits_lsb_first(pid, 8)), handshake);
  }
  else if ((type == TRIG_TOKEN_ADDRESS) || (type == TRIG_SOF_FRAME)) {
    var pid, field;
    if (type == TRIG_TOKEN_ADDRESS) {
      pid = TRIG_TOKEN_PIDS[ScanaStudio.gui_get_value("trig_addr_pid")];
      field = trig_integer("trig_address", 127) | (trig_integer("trig_endpoint", 15) << 7);
    }
    else {
      pid = USB_SOF;
      field = trig_integer("trig_frame", 2047);
    }
    var bits = usb_bits_lsb_first(0x80, 8).concat(usb_bits_lsb_first(pid, 8),
      usb_bits_lsb_first(field, 11), usb_bits_lsb_first(usb_crc5(field), 5));
    steps = trig_packet_steps(bits, true);
  }

  for (var i = 0; i < steps.length; i++) {
    var s = steps[i];
    var t_min = (s.t_min == undefined) ? -1 : s.t_min;
    var t_max = (s.t_max == undefined) ? -1 : s.t_max;
    ScanaStudio.flexitrig_append(trig_step(trig, s), (i == 0) ? -1 : t_min, (i == 0) ? -1 : t_max);
  }

  //The edges of a packet, half a bit either side of where its bits put them. They are looked
  //for after the end of an SE0 (EOP or reset), so that a payload copying them cannot match.
  function trig_packet_steps(bits, until_eop) {
    var line = usb_line_states(bits);
    var out = [{ j: "R", k: "0" }];
    var last_edge = -1;
    for (var b = 0; b < line.length; b++) {
      var previous = (b == 0) ? "J" : line[b - 1];
      if (line[b] != previous) {
        var step = { j: (line[b] == "K") ? "F" : "R" };
        if (last_edge >= 0) {
          step.t_min = (b - last_edge - 0.5) * trig.bit;
          step.t_max = (b - last_edge + 0.5) * trig.bit;
        }
        out.push(step);
        last_edge = b;
      }
    }
    if (until_eop) {
      //the SE0 of the EOP starts right after the last bit: whichever line is high goes low
      var step = (line[line.length - 1] == "J") ? { j: "F" } : { k: "F" };
      step.t_min = (line.length - last_edge - 0.5) * trig.bit;
      step.t_max = (line.length - last_edge + 0.5) * trig.bit;
      out.push(step);
    }
    return out;
  }

  function trig_step(trig, s) {
    var step = "";
    for (var c = 0; c < ScanaStudio.get_device_channels_count(); c++) {
      var cell = "X";
      if ((c == trig.j_line) && (s.j != undefined)) {
        cell = s.j;
      }
      else if ((c == trig.k_line) && (s.k != undefined)) {
        cell = s.k;
      }
      step = cell + step;
    }
    return step;
  }
}

/*
 * Packet encoding, shared by the trigger and the demo signals
*/

function usb_bits_lsb_first(value, count){
  var bits = [];
  for (var i = 0; i < count; i++) {
    bits.push((value >> i) & 1);
  }
  return bits;
}

//Bits as they are sent from SYNC on: a 0 is stuffed after six 1s, then NRZI from the idle J
function usb_line_states(bits){
  var states = [];
  var state = "J";
  var ones = 0;
  for (var i = 0; i < bits.length; i++) {
    if (bits[i] == 0) {
      state = (state == "J") ? "K" : "J";
      ones = 0;
    }
    else {
      ones++;
    }
    states.push(state);
    if (ones == 6) {
      state = (state == "J") ? "K" : "J";
      states.push(state);
      ones = 0;
    }
  }
  return states;
}

function usb_crc5(field){
  var crc = 0x1F;
  for (var i = 0; i < 11; i++) {
    var bit = (field >> i) & 1;
    crc = ((crc ^ bit) & 1) ? ((crc >> 1) ^ 0x14) : (crc >> 1);
  }
  return (~crc) & 0x1F;
}

function usb_crc16(bytes){
  var crc = 0xFFFF;
  for (var i = 0; i < bytes.length; i++) {
    for (var b = 0; b < 8; b++) {
      var bit = (bytes[i] >> b) & 1;
      crc = ((crc ^ bit) & 1) ? ((crc >> 1) ^ 0xA001) : (crc >> 1);
    }
  }
  return (~crc) & 0xFFFF;
}

/*
 * Demo signals: a device being enumerated, then polled
*/

var DEMO_MAX_FRAMES = 40;

function on_build_demo_signals(){
  var builder = ScanaStudio.BuilderObject;
  var samples_requested = ScanaStudio.builder_get_maximum_samples_count();
  var low_speed = (ScanaStudio.gui_get_value("is_low_speed") == 1);
  builder.config(ScanaStudio.gui_get_value("dp"), ScanaStudio.gui_get_value("dm"),
    ScanaStudio.builder_get_sample_rate(), low_speed);
  //A SOF (a keep-alive at low speed) every millisecond for the whole capture, but at most
  //DEMO_MAX_FRAMES frames with transactions, spread evenly: a long capture built bit by
  //bit would keep the demo device configuring for hours
  var frames_requested = Math.floor(samples_requested / builder.samples_for(1e-3));
  var busy_every = Math.max(1, Math.floor(frames_requested / DEMO_MAX_FRAMES));

  var frame = 0;
  var step = 0; //frames with transactions so far
  var toggle = 0;
  var suspended = false;
  builder.put_idle(200);
  builder.put_reset(10e-6);
  builder.put_idle(40);
  while ((builder.samples_acc() < samples_requested) && !ScanaStudio.abort_is_requested()) {
    var frame_start = builder.samples_acc();
    if (low_speed) {
      builder.put_eop(); //keep-alive
    }
    else {
      builder.put_packet(builder.token(USB_SOF, frame & 0x7FF));
    }
    builder.put_idle(20);
    var busy = (frame % busy_every == 0);
    if (busy) {
      switch (step) {
        case 0: //GET_DESCRIPTOR (device), first try NAKed
          builder.put_transaction(builder.token(USB_SETUP, 0), builder.data(USB_DATA0, [0x80, 0x06, 0x00, 0x01, 0x00, 0x00, 0x40, 0x00]), USB_ACK);
          builder.put_transaction(builder.token(USB_IN, 0), null, USB_NACK);
          break;
        case 1:
          builder.put_transaction(builder.token(USB_IN, 0), builder.data(USB_DATA1,
            [0x12, 0x01, 0x00, 0x02, 0x00, 0x00, 0x00, 0x08]), USB_ACK);
          builder.put_transaction(builder.token(USB_OUT, 0), builder.data(USB_DATA1, []), USB_ACK);
          break;
        case 2: //SET_ADDRESS 5
          builder.put_transaction(builder.token(USB_SETUP, 0), builder.data(USB_DATA0, [0x00, 0x05, 0x05, 0x00, 0x00, 0x00, 0x00, 0x00]), USB_ACK);
          builder.put_transaction(builder.token(USB_IN, 0), builder.data(USB_DATA1, []), USB_ACK);
          break;
        default: //the device at address 5: polled on EP1 IN, written on EP2 OUT, EP3 stalled
          if (step % 3 == 0) {
            builder.put_transaction(builder.token(USB_IN, 5 | (1 << 7)), null, USB_NACK);
          }
          else {
            builder.put_transaction(builder.token(USB_IN, 5 | (1 << 7)),
              builder.data(toggle ? USB_DATA1 : USB_DATA0, [step & 0xFF, 0x80, 0x00, 0xFF]), USB_ACK);
            toggle ^= 1;
          }
          builder.put_transaction(builder.token(USB_OUT, 5 | (2 << 7)), builder.data(USB_DATA0, [0x01, 0x02, 0x03, step & 0xFF]), USB_ACK);
          if (step % 5 == 0) {
            builder.put_transaction(builder.token(USB_IN, 5 | (3 << 7)), null, USB_STALL);
          }
          break;
      }
      step++;
    }
    frame++;
    //once, the bus is suspended then resumed if there is room for it
    if (busy && !suspended && (step == 6) && (builder.samples_left(samples_requested) > builder.samples_for(6e-3))) {
      builder.put_idle_time(3.5e-3);
      builder.put_resume(1.5e-3);
      builder.put_idle(40);
      suspended = true;
    }
    else {
      builder.put_idle_until(Math.min(frame_start + builder.samples_for(1e-3), samples_requested));
    }
  }
}

//Builder object that can be shared to other scripts: whole packets on D+ and D-
ScanaStudio.BuilderObject = {
  config: function(ch_dp, ch_dm, sample_rate, low_speed){
    this.ch_dp = ch_dp;
    this.ch_dm = ch_dm;
    this.sample_rate = sample_rate;
    this.low_speed = low_speed;
    this.samples_per_bit = sample_rate / (low_speed ? 1500000 : 12000000);
    this.position = 0; //in samples, fractional
    this.written = 0;  //in samples, as written
  },
  samples_acc: function(){
    return this.written;
  },
  samples_for: function(seconds){
    return Math.round(seconds * this.sample_rate);
  },
  samples_left: function(total){
    return total - this.written;
  },
  //state: "J", "K" or "SE0", held for a number of bits (fractional allowed)
  put_state: function(state, bits){
    this.position += bits * this.samples_per_bit;
    var n = Math.round(this.position) - this.written;
    if (n <= 0) {
      return;
    }
    var dp_level = 0, dm_level = 0;
    if (state != "SE0") {
      var j = (state == "J");
      dp_level = (j != this.low_speed) ? 1 : 0;
      dm_level = 1 - dp_level;
    }
    ScanaStudio.builder_add_samples(this.ch_dp, dp_level, n);
    ScanaStudio.builder_add_samples(this.ch_dm, dm_level, n);
    this.written += n;
  },
  put_idle: function(bits){
    this.put_state("J", bits);
  },
  put_idle_time: function(seconds){
    this.put_state("J", seconds * this.sample_rate / this.samples_per_bit);
  },
  put_idle_until: function(sample){
    if (sample > this.written) {
      this.put_state("J", (sample - this.position) / this.samples_per_bit);
    }
  },
  put_reset: function(seconds){
    this.put_state("SE0", seconds * this.sample_rate / this.samples_per_bit);
  },
  put_eop: function(){
    this.put_state("SE0", 2);
    this.put_state("J", 1);
  },
  //K held by the host, ended by a low speed EOP
  put_resume: function(seconds){
    this.put_state("K", seconds * this.sample_rate / this.samples_per_bit);
    this.put_state("SE0", 2 * this.samples_per_bit_ls() / this.samples_per_bit);
    this.put_state("J", 1);
  },
  samples_per_bit_ls: function(){
    return this.sample_rate / 1500000;
  },
  token: function(pid, field){
    var crc = 0x1F;
    for (var i = 0; i < 11; i++) {
      var bit = (field >> i) & 1;
      crc = ((crc ^ bit) & 1) ? ((crc >> 1) ^ 0x14) : (crc >> 1);
    }
    crc = (~crc) & 0x1F;
    return [pid, field & 0xFF, ((field >> 8) & 0x07) | (crc << 3)];
  },
  data: function(pid, bytes){
    var crc = 0xFFFF;
    for (var i = 0; i < bytes.length; i++) {
      for (var b = 0; b < 8; b++) {
        var bit = (bytes[i] >> b) & 1;
        crc = ((crc ^ bit) & 1) ? ((crc >> 1) ^ 0xA001) : (crc >> 1);
      }
    }
    crc = (~crc) & 0xFFFF;
    return [pid].concat(bytes, [crc & 0xFF, crc >> 8]);
  },
  //SYNC, the bytes LSB first with bit stuffing, NRZI, then the EOP
  put_packet: function(bytes){
    var state = "J";
    var ones = 0;
    var all = [0x80].concat(bytes);
    for (var i = 0; i < all.length; i++) {
      for (var b = 0; b < 8; b++) {
        if ((all[i] >> b) & 1) {
          ones++;
        }
        else {
          state = (state == "J") ? "K" : "J";
          ones = 0;
        }
        this.put_state(state, 1);
        if (ones == 6) {
          state = (state == "J") ? "K" : "J";
          this.put_state(state, 1);
          ones = 0;
        }
      }
    }
    this.put_eop();
  },
  put_transaction: function(token, data, handshake){
    this.put_packet(token);
    this.put_idle(4);
    if (data != null) {
      this.put_packet(data);
      this.put_idle(4);
    }
    this.put_packet([handshake]);
    this.put_idle(30);
  }
};

function format_float(fl){
  return Math.round(fl*1000)/1000;
}

//Parse setup request. Source: https://eleccelerator.com/usbdescreqparser/ 
function parse_stdrequest(inVals, startIndex){

  function pDescriptorType(x){
    var tbl = [
      "Undefined",
      "Device",
      "Configuration",
      "String",
      "Interface",
      "Endpoint",
      "Device Qualifier",
      "Other Speed",
      "Interface Power",
      "OTG",
      "Unknown","Unknown","Unknown","Unknown","Unknown","Unknown",
      "Unknown","Unknown","Unknown","Unknown","Unknown","Unknown","Unknown","Unknown","Unknown","Unknown","Unknown","Unknown","Unknown","Unknown","Unknown","Unknown",
      "Unknown",
      "HID", // 0x21
      "HID Report",
      "Unknown",
      "Dependant on Type",
      "Dependant on Type",
      "Unknown","Unknown","Unknown",
      "Hub", // 0x29
    ];
    if (x < 0 || x >= tbl.length) {
      possible_errors++;
      return "Unknown";
    } else {
      if (tbl[x] == "Unknown" || tbl[x] == "Undefined") {
        possible_errors++;
      }
      return tbl[x];
    }
  }

  var str = "";
  var bLength, bDescriptorType;
  var j = -2;

  var bmRequestType = -1;
  var bRequest = -1;
  var wValue = -1;
  var wIndex = -1;
  var wLength = -1;

  for (var i = 0; i < inVals.length; ){
    if (i == 0){
      bmRequestType = inVals[i++];
      
      if ((bmRequestType & 0x80) != 0) {
        str = "IN, ";
      } else {
        str = "OUT, ";
      }
      
      if (((bmRequestType >> 5) & 0x03) == 0x00) {
        str += "Standard, ";
      }
      else if (((bmRequestType >> 5) & 0x03) == 0x01) {
        str += "Class, ";
      }
      else if (((bmRequestType >> 5) & 0x03) == 0x02) {
        str += "Vendor, ";
      }
      else if (((bmRequestType >> 5) & 0x03) == 0x03) {
        str += "Reserved, ";
      }
      
      if ((bmRequestType & 0x1F) == 0x00) {
        str += "Device";
      }
      else if ((bmRequestType & 0x1F) == 0x01) {
        str += "Interface";
      }
      else if ((bmRequestType & 0x1F) == 0x02) {
        str += "Endpoint";
      }
      else if ((bmRequestType & 0x1F) == 0x03) {
        str += "Other";
      }
      else {
        str += "Reserved";
      }
      
      ScanaStudio.packet_view_add_packet(false, dm, startIndex, startIndex+1, "bmRequestType", str, "#000000", "#333333");
    }
    else if (i == 1) {
      bRequest = inVals[i++];
      var tbl = [ "Get Status", "Clear Feature", "Reserved", "Set Feature", "Reserved", "Set Address", "Get Descriptor", "Set Descriptor", "Get Config", "Set Config", "Get Interface", "Set Interface", "Sync Frame", ];
      if ((((bmRequestType >> 5) & 0x03) == 0x00) && bRequest < tbl.length){
        str = tbl[bRequest];
      } else {
        str = pHex(bRequest);
      }
      ScanaStudio.packet_view_add_packet(false, dm, startIndex+1, startIndex+2, "bRequest", str, "#000000", "#333333");
    }
    else if (i == 2) {
      wValue = inVals[i++];
      if (((bmRequestType >> 5) & 0x03) == 0x00 && (bRequest == 0x06 || bRequest == 0x07)) {
        ScanaStudio.packet_view_add_packet(false, dm, startIndex+2, startIndex+3, "Desc Index", wValue.toString(10), "#000000", "#333333");
      }
    }
    else if (i == 3) {
      wValue += inVals[i] << 8;
      if (((bmRequestType >> 5) & 0x03) == 0x00){
        if (bRequest == 0x06 || bRequest == 0x07) {
          ScanaStudio.packet_view_add_packet(false, dm, startIndex+3, startIndex+4, "Desc Type", pDescriptorType(inVals[i]), "#000000", "#333333");
        }
        else if (bRequest == 0x01 || bRequest == 0x03) {
          ScanaStudio.packet_view_add_packet(false, dm, startIndex+3, startIndex+4, "Feature Selector", wValue.toString(10), "#000000", "#333333");
        }
        else if (bRequest == 0x05) {
          ScanaStudio.packet_view_add_packet(false, dm, startIndex+3, startIndex+4, "Device Addr", wValue.toString(10), "#000000", "#333333");
        }
        else if (bRequest == 0x09) {
          ScanaStudio.packet_view_add_packet(false, dm, startIndex+3, startIndex+4, "Config Num", wValue.toString(10), "#000000", "#333333");
        }
        else if (bRequest == 0x0B) {
          ScanaStudio.packet_view_add_packet(false, dm, startIndex+3, startIndex+4, "Alt Setting", wValue.toString(10), "#000000", "#333333");
        }
        else {
          ScanaStudio.packet_view_add_packet(false, dm, startIndex+3, startIndex+4, "wValue", pHex(wValue), "#000000", "#333333");
        }
      } else {
        ScanaStudio.packet_view_add_packet(false, dm, startIndex+3, startIndex+4, "wValue", pHex(wValue), "#000000", "#333333");
      }
      i++;
    }
    else if (i == 4){
      wIndex = inVals[i++];
    }
    else if (i == 5){
      wIndex += inVals[i] << 8;
      if (((bmRequestType >> 5) & 0x03) == 0x00){
        if ((bmRequestType == 0x01 && bRequest == 0x01) || (bmRequestType == 0x81 && bRequest == 0x0A) || (bmRequestType == 0x81 && bRequest == 0x00) || (bmRequestType == 0x01 && bRequest == 0x03) || (bmRequestType == 0x01 && bRequest == 0x0B)) {
          ScanaStudio.packet_view_add_packet(false, dm, startIndex+4, startIndex+5, "Interface", wIndex.toString(10), "#000000", "#333333");
        }
        else if ((bmRequestType == 0x02 && bRequest == 0x01) || (bmRequestType == 0x82 && bRequest == 0x00) || (bmRequestType == 0x02 && bRequest == 0x03) || (bmRequestType == 0x82 && bRequest == 0x0C)) {
          var pstr = "";
          if (wIndex & 0x80 != 0) {
            pstr += " IN";
          }
          else {
            pstr += " OUT";
          }
          ScanaStudio.packet_view_add_packet(false, dm, startIndex+4, startIndex+5, "Endpoint", pHex(wIndex) + pstr, "#000000", "#333333");
        }
        else if (bRequest == 0x06 || bRequest == 0x07) {
          ScanaStudio.packet_view_add_packet(false, dm, startIndex+4, startIndex+5, "Language ID", pHex(wIndex), "#000000", "#333333");
        } else {
          ScanaStudio.packet_view_add_packet(false, dm, startIndex+4, startIndex+5, "wIndex", pHex(wIndex), "#000000", "#333333");
        }
      } else {
        ScanaStudio.packet_view_add_packet(false, dm, startIndex+4, startIndex+5, "wIndex", pHex(wIndex), "#000000", "#333333");
      }
      i++;
    }
    else if (i == 6){
      wLength = inVals[i++];
    }
    else if (i == 7){
      wLength += inVals[i] << 8;
      ScanaStudio.packet_view_add_packet(false, dm, startIndex+5, startIndex+6, "wLength", wLength.toString(10), "#000000", "#333333");
      i++;
    }
  }
}
