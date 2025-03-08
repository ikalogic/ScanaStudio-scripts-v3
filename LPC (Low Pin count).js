/* Protocol meta info:
<NAME> LPC (Low Pin Count) </NAME>
<DESCRIPTION>
The LPC protocol is a low-pin-count bus developed by Intel to replace older, bulkier interfaces like the ISA bus in PCs.
</DESCRIPTION>
<VERSION> 0.1 </VERSION>
<AUTHOR_NAME> Ibrahim KAMAL </AUTHOR_NAME>
<AUTHOR_URL> contact@ikalogic.com </AUTHOR_URL>
<HELP_URL> https://github.com/ikalogic/ScanaStudio-scripts-v3/wiki </HELP_URL>
<COPYRIGHT> Copyright Ibrahim KAMAL </COPYRIGHT>
<LICENSE> This code is distributed under the terms of the GNU General Public License GPLv3 </LICENSE>
<RELEASE_NOTES>
V0.1:  Initial release. Partially tested.
</RELEASE_NOTES>
*/

//TODO:
//Allow GUI to change data format (binary, hex, dec)
//Add to Packet view:
//* bandwidth (MB)
//* Access time (us)

const PacketColor = {
    title: "#0a2f35", //Dark blue
    control: "#ffca7a", //light yellow
    address: "#f7a325",
    data: "#37d48a",
    err: "#f56038",
    warn: "#f7a325",
};

const reserved_start_values = [0x1, 0x4, 0x5, 0x6, 0x7, 0x8, 0x9, 0xA, 0xB, 0xC];
const StartEncoding = {
    MEMORY: 0x0,
    GRANT0: 0x2,
    GRANT1: 0x3,
    FW_READ: 0xD,
    FW_WRITE: 0xE,
    STOP: 0xF,
    NULL: 0xFF //Only used for decoder
};

const SyncType = {
    ACHIEVED: 0,
    NORMAL: 0x5,
    EXTENDED: 0x6,
    SPECIAL: 0xA,
    RESERVED: 0xF
};

const DirType = {
    READ: 0,
    WRITE: 1
};

const DmaType = {
    Host_to_perif: 1,
    perif_to_host: 0
}

function LPCFrame() {
    this.start = StartEncoding.NULL; // Start field
    this.ctdir = null; //cycle type and direction field
    this.idsel = null; //cycle type and direction field
    this.tar = null; // Turnaround field
    this.sync = null; // Sync field
    this.channel = 0;
    this.terminal_count = null;
    this.address = 0; // Address field
    this.timestamp = null; // Timestamp of the frame

    //internals and helper functions for the decoder
    //this.lframe_start_samples;
    //this.lframe_end_samples;
    this.start_clk_fall;
    this.start_clk_rize;
    this.tar_count = 0;
    this.abort_start_sample = 0;
    this.address_sample_point = [8];
    this.address_nibs = [8]; //maybe unused
    this.curr_addr_nib = 0;
    this.cur_data_byte = 0;
    this.data_sample_point;
    this.address_size = 8;
    this.data_size = 8;
    this.data_counter = 0;
    this.cur_data_nib = 0;
    this.dir = null;
    this.is_dma = false;
    this.clk_width = 0;
    this.clk_margin = 0;

    this.process_start = function (start, clk_rize) {
        this.start = start;
        var packet_time = clk_rize / sampling_rate;
        ScanaStudio.packet_view_add_packet(true /* bool */,
            ch_lframe /* int */,
            clk_rize /* int */,
            clk_rize /* int */,
            "LPC Frame" /* string */,
            "At time: " + ScanaStudio.engineering_notation(packet_time, 6 /* int */) + "s",
            PacketColor.title /* string */,
            PacketColor.title /* string */);
        if (this.start == StartEncoding.MEMORY) {
            this.new_dec_item("MEMORY Start", "Memory", "M", start, clk_rize, false, PacketColor.control);
        } else if ((this.start == StartEncoding.FW_READ) || (this.start == StartEncoding.FW_WRITE)) {
            if (this.start == StartEncoding.FW_READ) {
                this.dir = DirType.READ;
                this.new_dec_item("Firmware Read", "FW Read", "R", start, clk_rize, false, PacketColor.control);
            }
            else {
                this.dir = DirType.WRITE;
                this.new_dec_item("Firmware Write", "FW Write", "W", start, clk_rize, false, PacketColor.control);
            }
            this.data_size = 0; //is defined later
            this.address_size = 7;
        }
        else if (this.start == StartEncoding.GRANT0) {
            this.new_dec_item("Bus Master 0", "Master 0", "M0", start, clk_rize, false, PacketColor.control);
        }
        else if (this.start == StartEncoding.GRANT1) {
            this.new_dec_item("Bus Master 1", "Master 1", "M1", start, clk_rize, false, PacketColor.control);
        }
        else {
            for (var i = 0; i < reserved_start_values.length; i++) {
                if (start == reserved_start_values[i]) {
                    if (reserved_start_as_memory[i] == 0) {
                        this.new_dec_item("Reserved Start", "Reserved", "R", start, clk_rize, true, PacketColor.err);
                        return false;
                    }
                    else {
                        this.new_dec_item("Reserved Start", "Reserved", "R", start, clk_rize, false, PacketColor.warn);
                        this.start = StartEncoding.MEMORY;
                        return true;
                    }
                }
            }
        }
        return true;
    }

    this.process_ctdir_idsel = function (ctdir_idsel, clk_rize) {
        if (this.start == StartEncoding.MEMORY) {
            var ct = (ctdir_idsel >> 2) & 0x3;
            if ((this.ctdir & 0x2) == 0x0) {
                this.dir = DirType.READ;
            }
            else if ((this.ctdir & 0x2) == 0x2) {
                this.dir = DirType.WRITE;
            }
            this.ctdir = ctdir_idsel;
            if (ct == 0) //I/O
            {
                this.data_size = 2;
                this.address_size = 4;
                if (this.dir == DirType.READ) {
                    this.new_dec_item("I/O Read", "Read", "R", ctdir_idsel, clk_rize, false, PacketColor.control);
                }
                else if (this.dir == DirType.WRITE) {
                    this.new_dec_item("I/O Write", "Write", "W", ctdir_idsel, clk_rize, false, PacketColor.control);
                }
            }
            else if (ct == 1) //Memory
            {
                if (this.dir == DirType.READ) {
                    this.new_dec_item("Memory Read", "Read", "R", ctdir_idsel, clk_rize, false, PacketColor.control);
                }
                else if (this.dir == DirType.WRITE) {
                    this.new_dec_item("Memory Write", "Write", "W", ctdir_idsel, clk_rize, false, PacketColor.control);
                }
                this.data_size = 2;
                this.address_size = 8;
            }
            else if (ct == 2) //DMA
            {
                if (this.dir == DirType.READ) {
                    this.new_dec_item("DMA Read", "Read", "R", ctdir_idsel, clk_rize, false, PacketColor.control);
                }
                else if (this.dir == DirType.WRITE) {
                    this.new_dec_item("DMA Write", "Write", "W", ctdir_idsel, clk_rize, false, PacketColor.control);
                }
                this.is_dma = true;
                this.data_size = 0; //is defined later
                this.dir = !this.dir; //DMA have opposite packet structure than other types.
                //e.g. in DMA Read (Host to Perif) data is written by Host.
                //This inversion is done to harmonize the decoder's state machine
            }
            else if (ct == 3) //Invalid
            {
                this.new_dec_item("Invalid CTDIR", "Invalid", "X", ctdir_idsel, clk_rize, true, "#C00000");
            }
        }
        else if ((this.start == StartEncoding.FW_READ) || (this.start == StartEncoding.FW_WRITE)) {
            this.new_dec_item("Select Firmware (IDSEL)", "IDSEL", "ID", ctdir_idsel, clk_rize, false, PacketColor.control);
            this.idsel = ctdir_idsel;
            this.data_size = 0; //is defined later
            this.address_size = 7;
        }
        else {
            throw "Unhandled START message";
        }
    };

    this.process_channel = function (d, clk_rize) {
        this.channel = d & 0x7;
        this.terminal_count = (d >> 3) & 0x1;
        this.new_dec_item("Channel", "Channel", "CH", d, clk_rize, false, PacketColor.control);
    }

    this.process_size = function (d, clk_rize) {
        var bits;
        switch (d & 0x3) {
            case 0:
                bits = 8;
                break;
            case 1:
                bits = 16;
                break;
            case 2:
                bits = 0; //reserved
                break;
            case 3:
                bits = 32;
                break;
            default:
                break;
        }
        this.data_size = bits / 4;
        this.new_dec_item("Size (Bytes)", "Size (B)", "S", d, clk_rize, false, PacketColor.control);
    }

    this.process_msize = function (msize, clk_rize) {
        //According to Table 4 in the LPC spec
        switch (msize) {
            case 0:
                this.data_size = 1 * 2;
                break;
            case 1:
                this.data_size = 2 * 2;
                break;
            case 2:
                this.data_size = 4 * 2;
                break;
            case 4:
                this.data_size = 16 * 2;
                break;
            case 7:
                this.data_size = 128 * 2;
                break;
            default:
                return false;
        }
        this.new_dec_item("Memory Size (Bytes)", "Size (B)", "S", msize, clk_rize, false, PacketColor.control);
        return true;
    }

    this.process_tar = function (tar, clk_rize, tar_cycle) {
        this.tar = tar;
        this.tar_count++;
        this.new_dec_item("Turnaround " + tar_cycle,
            "Turnaround " + tar_cycle, "TAR" + tar_cycle, tar, clk_rize, false, PacketColor.control);
        if (this.tar_count == 2) {
            this.tar_count = 0;
            return true;
        }
        else {
            return false;
        }
    };

    this.process_sync = function (sync, clk_rize) {
        this.sync = sync;
        if (lpc_abort == false) {
            if (this.sync == SyncType.NORMAL) {
                this.new_dec_item("Sync", "Sync", "s", sync, clk_rize, false, PacketColor.control);
            }
            else if (this.sync == SyncType.EXTENDED) {
                this.new_dec_item("Extended Sync", "E Sync", "Es", sync, clk_rize, false, PacketColor.control);
            }
            else if (this.sync == SyncType.ACHIEVED) {
                this.new_dec_item("Sync Achieved", "Sync OK", "S", sync, clk_rize, false, PacketColor.control);
            }
            else if (this.sync == SyncType.SPECIAL) {
                this.new_dec_item("Special Sync", "Special Sync", "S?", sync, clk_rize, false, PacketColor.control);
            }
            else {
                this.new_dec_item("Reserved Sync", "R Sync", "S!", sync, clk_rize, true, PacketColor.control);
                this.sync = SyncType.RESERVED;
            }
        }
    };

    this.push_address_nib = function (a, clk_rize) {
        this.address = (this.address << 4) | a;
        this.address_nibs[this.curr_addr_nib] = a;
        this.address_sample_point[this.curr_addr_nib] = clk_rize;
        this.curr_addr_nib++;
        this.new_nib_item(a, clk_rize);


        if (frame.curr_addr_nib == frame.address_size) {
            var formatted_value;
            formatted_value = format(this.address, 1, 8);


            var start = this.address_sample_point[0] - this.clk_margin;
            var end = clk_rize + this.clk_width;
            ScanaStudio.dec_item_new(ch_lframe,
                start,
                end);
            ScanaStudio.dec_item_add_content("Address: " + formatted_value);
            ScanaStudio.dec_item_add_content("Addr: " + formatted_value);
            ScanaStudio.dec_item_add_content("@ " + formatted_value);
            ScanaStudio.dec_item_add_content(formatted_value);
            for (var i = 0; i < this.curr_addr_nib; i++) {
                ScanaStudio.dec_item_add_sample_point(this.address_sample_point[i], "R");
            }
            ScanaStudio.dec_item_end();

            ScanaStudio.packet_view_add_packet(false /* bool */,
                ch_lframe /* int */,
                start /* int */,
                end /* int */,
                "Address" /* string */,
                formatted_value /* string */,
                PacketColor.address /* string */,
                PacketColor.address /* string */);
        }
    };

    this.push_data_nib = function (d, clk_rize) {
        this.cur_data_byte |= (d << (this.cur_data_nib * 4));
        this.cur_data_nib++;
        this.new_nib_item(d, clk_rize);

        if (this.cur_data_nib % 2 == 0) {
            var formatted_value;
            formatted_value = format(this.cur_data_byte, 1, 8);
            var start = this.data_sample_point - this.clk_margin;
            var end = clk_rize + this.clk_width;
            ScanaStudio.dec_item_new(ch_lframe,
                start,
                end);
            ScanaStudio.dec_item_add_content("Data [" + this.data_counter + "] : " + formatted_value);
            ScanaStudio.dec_item_add_content("D [" + this.data_counter + "] : " + formatted_value);
            ScanaStudio.dec_item_add_content(formatted_value);
            ScanaStudio.dec_item_add_sample_point(this.data_sample_point, "R");
            ScanaStudio.dec_item_add_sample_point(clk_rize, "R");
            ScanaStudio.dec_item_end();

            ScanaStudio.packet_view_add_packet(false /* bool */,
                ch_lframe /* int */,
                start /* int */,
                end /* int */,
                "Data" /* string */,
                formatted_value /* string */,
                PacketColor.data /* string */,
                PacketColor.data /* string */);

            this.cur_data_byte = 0;
            this.data_counter++;
        }
        this.data_sample_point = clk_rize;
    };

    this.process_stop = function (clk_rize) {
        formatted_value = format(0xF, 1, 4);
        var start = this.abort_start_sample - this.clk_margin;
        var end = clk_rize + this.clk_width;
        ScanaStudio.dec_item_new(ch_lframe,
            start,
            end);
        ScanaStudio.dec_item_add_content("STOP " + formatted_value);
        ScanaStudio.dec_item_add_content("P " + formatted_value);
        ScanaStudio.dec_item_add_content("P");
        ScanaStudio.dec_item_end();
    }

    this.new_dec_item = function (long_title, title, short_title, value, clk_rize, emph_error, pkt_color) {
        if ((emph_error == undefined) || (emph_error === undefined) || (emph_error == null)) {
            emph_error = false;
        }


        var formatted_value;
        formatted_value = format(value, 1, 4);
        var bin_value;
        bin_value = format(value, 2, 4);

        var start = clk_rize - (this.clk_margin);
        var end = clk_rize + this.clk_width;
        ScanaStudio.dec_item_new(ch_lframe,
            start,
            end);
        ScanaStudio.dec_item_add_content(long_title + " " + formatted_value);
        ScanaStudio.dec_item_add_content(title + " " + formatted_value);
        ScanaStudio.dec_item_add_content(short_title + " " + formatted_value);
        ScanaStudio.dec_item_add_content(formatted_value);
        ScanaStudio.dec_item_add_sample_point(clk_rize, "D");
        if (emph_error) {
            ScanaStudio.dec_item_emphasize_error();
            pkt_color = PacketColor.err;
        }
        ScanaStudio.dec_item_end();

        if (pkt_color != undefined) {
            ScanaStudio.packet_view_add_packet(false /* bool */,
                ch_lframe /* int */,
                start /* int */,
                end /* int */,
                long_title /* string */,
                formatted_value + " " + bin_value /* string */,
                pkt_color /* string */,
                pkt_color /* string */);
        }
    }

    this.new_nib_item = function (value, clk_rize) {
        var bin_value;
        bin_value = format(value, 2, 4, false);

        var start = clk_rize - (this.clk_margin);
        var end = clk_rize + this.clk_width;
        ScanaStudio.dec_item_new(ch_clk,
            start,
            end);
        ScanaStudio.dec_item_add_content(bin_value);
        ScanaStudio.dec_item_end();
    }
}


const DecoderState = {
    IDLE: 0,
    START: 100,
    CTDIR_IDSEL: 110,
    PERIF_TAR: 115,
    //PERIF_CTDIR: 116,
    CHANNEL: 120,
    SIZE: 150,
    ADDRESS: 200,
    MSIZE: 250,
    //PSIZE: 260,
    TAR1: 300,
    TAR2: 302,
    SYNC: 400,
    DATA: 500,
    END: 600,
    STOP: 700,
    ERROR: 900
};

//Decoder GUI
var ch_clk;
var ch_lframe;
var ch_lad = new Array(4);
var reserved_start_as_memory = new Array(10);
var clk_active_edge = 1;
var lframe_active_edge = 0;
var decoder_state;
var data_width = 4;
var lsb_first = true;
var lpc_abort = false;
function on_draw_gui_decoder() {

    ScanaStudio.gui_add_ch_selector("ch_clk" /* string */,
        "LCLK" /* string */,
        "LCLK" /* string */,
        0 /* int [default = -1] */);

    ScanaStudio.gui_add_ch_selector("ch_lframe" /* string */,
        "LFRAME#" /* string */,
        "LFRAME#" /* string */,
        1 /* int [default = -1] */);

    ScanaStudio.gui_add_separator("LAD (LPC Address/Data)" /* string [default = ""] */);

    for (i = 0; i < 4; i++) {
        ScanaStudio.gui_add_ch_selector("ch_lad" + i /* string */,
            "LAD " + i /* string */,
            "LAD " + i /* string */,
            2 + i /* int [default = -1] */);
    }

    ScanaStudio.gui_add_new_tab("Reserved START varlues" /* string */, false /* bool */)
    ScanaStudio.gui_add_info_label("Decide how the decoder deals with reserved Start values" /* string */);

    for (var i = 0; i < reserved_start_values.length; i++) {
        const value = reserved_start_values[i];
        ScanaStudio.gui_add_combo_box("reserved_" + value /* string */,
            "If START field = " + format(value, 1, 4) + " (" + format(value, 2, 4) + "), then: " /* string */);
        ScanaStudio.gui_add_item_to_combo_box("Ignore rest of frame");
        ScanaStudio.gui_add_item_to_combo_box("Treat as MEMORY (0000))", true);
    }
    ScanaStudio.gui_end_tab();
}

//Evaluate decoder GUI
function on_eval_gui_decoder() {
    return ""; //All good.
}

function read_gui_values() {
    ch_clk = ScanaStudio.gui_get_value("ch_clk");
    ch_lframe = ScanaStudio.gui_get_value("ch_lframe");
    for (i = 0; i < 4; i++) {
        ch_lad[i] = ScanaStudio.gui_get_value("ch_lad" + i);
    }
    for (var i = 0; i < reserved_start_values.length; i++) {
        const value = reserved_start_values[i];
        reserved_start_as_memory[i] = ScanaStudio.gui_get_value("reserved_" + value);
    }
}

function end_of_samples() {
    if ((ScanaStudio.trs_is_not_last(ch_clk))) {
        return false;
    }
    return true;
}

//Global variables
var sampling_rate;
var trs_lframe;
var trs_lclk;
var captured_data;
var last_clk_fall;
var nibble_after_start;
var skip_next_capture = false;
var frame = new LPCFrame();
var start_valid = false;
function on_decode_signals(resume) {
    if (!resume) //If resume == false, it's the first call to this function.
    {
        //initialization code goes here, ex:
        lpc_abort = false;
        sampling_rate = ScanaStudio.get_capture_sample_rate();
        // read GUI values using ScanaStudio.gui_get_value("ID");
        read_gui_values();
        decoder_state = DecoderState.IDLE;
        //reset iterators for all channels
        ScanaStudio.trs_reset(ch_clk);
        ScanaStudio.trs_reset(ch_lframe);
        for (i = 0; i < 4; i++) {
            ScanaStudio.trs_reset(ch_lad[i]);
        }
    }

    while (ScanaStudio.abort_is_requested() == false) {
        // if (end_of_samples()) {
        //     return;
        // }

        if (lpc_abort) {
            decoder_state = DecoderState.STOP;
            lpc_abort = false;
        }

        if (decoder_state > DecoderState.IDLE) {
            if (ScanaStudio.trs_is_not_last(ch_clk) == false) {
                return;
            }
            if (skip_next_capture == false) {
                trs_lclk = ScanaStudio.trs_get_next(ch_clk);
                if (trs_lclk.value != clk_active_edge) {
                    last_clk_fall = trs_lclk.sample_index;
                    continue;
                }
                else {
                    frame.clk_width = trs_lclk.sample_index - last_clk_fall;
                    frame.clk_margin = frame.clk_width / 2 - 1;
                }
                captured_data = capture_data_at(trs_lclk.sample_index);
            }
            skip_next_capture = false;
        }

        switch (decoder_state) {
            case DecoderState.IDLE:
                //Search for LFRAME active edge
                if (ScanaStudio.trs_is_not_last(ch_lframe) == false) {
                    return;
                }
                trs_lframe = ScanaStudio.trs_get_next(ch_lframe);
                if (trs_lframe.value == lframe_active_edge) {
                    frame = new LPCFrame();
                    //frame.lframe_start_samples = trs_lframe.sample_index;
                    decoder_state = DecoderState.START;
                    trs_lclk = ScanaStudio.trs_get_before(ch_clk, trs_lframe.sample_index);
                }
                break;
            case DecoderState.START:
                var lframe_val = ScanaStudio.trs_get_before(ch_lframe, trs_lclk.sample_index).value;
                if (lframe_val != lframe_active_edge) {
                    skip_next_capture = true; //we don't need to fetch the next sample
                    if ((frame.start == StartEncoding.GRANT0) || (frame.start == StartEncoding.GRANT1)) {
                        decoder_state = DecoderState.TAR1;
                    }
                    else if (start_valid) {
                        decoder_state = DecoderState.CTDIR_IDSEL;
                    }
                    else {
                        decoder_state = DecoderState.IDLE;
                    }
                }
                else {
                    start_valid = frame.process_start(captured_data, trs_lclk.sample_index);
                }
                break;
            case DecoderState.CTDIR_IDSEL:
                frame.process_ctdir_idsel(captured_data, trs_lclk.sample_index);
                if (frame.is_dma) {
                    decoder_state = DecoderState.CHANNEL;
                } else {
                    decoder_state = DecoderState.ADDRESS;
                }
                break;
            case DecoderState.CHANNEL: //DMA
                frame.process_channel(captured_data, trs_lclk.sample_index);
                decoder_state = DecoderState.SIZE;
                break;
            case DecoderState.SIZE: //DMA
                frame.process_size(captured_data, trs_lclk.sample_index);
                if (frame.dir == DmaType.Host_to_perif) {
                    decoder_state = DecoderState.DATA;
                } else {
                    decoder_state = DecoderState.TAR1;
                }
                break;
            case DecoderState.ADDRESS:
                frame.push_address_nib(captured_data, trs_lclk.sample_index);
                if (frame.curr_addr_nib == frame.address_size) {
                    if (frame.start == StartEncoding.MEMORY) {
                        if (frame.dir == DirType.READ) {
                            decoder_state = DecoderState.TAR1;
                        }
                        else {
                            decoder_state = DecoderState.DATA;
                        }
                    } else if ((frame.start == StartEncoding.FW_READ) || (frame.start == StartEncoding.FW_WRITE)) {
                        decoder_state = DecoderState.MSIZE;
                    } else if ((frame.start == StartEncoding.GRANT0) || (frame.start == StartEncoding.GRANT1)) {
                        decoder_state = DecoderState.SIZE;
                    }
                }
                break;
            case DecoderState.MSIZE:
                frame.process_msize(captured_data, trs_lclk.sample_index);
                if (frame.dir == DirType.READ) {
                    decoder_state = DecoderState.TAR1;
                } else {
                    decoder_state = DecoderState.DATA;
                }
                break;
            case DecoderState.DATA:
                frame.push_data_nib(captured_data, trs_lclk.sample_index);
                if (frame.cur_data_nib == frame.data_size) {
                    if (frame.dir == DirType.READ) {
                        decoder_state = DecoderState.TAR2;
                    }
                    else {
                        decoder_state = DecoderState.TAR1;
                    }
                }
                break;
            case DecoderState.PERIF_TAR:
                if (frame.process_tar(captured_data, trs_lclk.sample_index, "P")) {
                    decoder_state = DecoderState.CTDIR_IDSEL;
                }
                break;
            case DecoderState.TAR1:
                if (frame.process_tar(captured_data, trs_lclk.sample_index, "1")) {
                    decoder_state = DecoderState.SYNC;
                }
                break;
            case DecoderState.SYNC:
                frame.process_sync(captured_data, trs_lclk.sample_index);
                if (frame.sync == SyncType.ACHIEVED) {
                    if (frame.dir == DirType.READ) {
                        decoder_state = DecoderState.DATA;
                    } else {
                        decoder_state = DecoderState.TAR2;
                    }
                }
                break;
            case DecoderState.TAR2:
                if (frame.process_tar(captured_data, trs_lclk.sample_index, "2")) {
                    decoder_state = DecoderState.END;
                }
                break;
            case DecoderState.STOP:
                //Wait for the end of the abort cycle
                frame.process_stop(trs_lframe.sample_index);
                decoder_state = DecoderState.IDLE;
                break;
            case DecoderState.END:
                decoder_state = DecoderState.IDLE; //Wait for next frame
                break;
        }
    }
}

function capture_data_at(target_sample) {
    var lframe_val = ScanaStudio.trs_get_before(ch_lframe, target_sample).value;
    var ret = 0;
    var val;
    for (var i = 0; i < data_width; i++) {
        val = ScanaStudio.trs_get_before(ch_lad[i], target_sample).value;
        if (lsb_first) {
            ret |= (val << i);
        }
        else {
            ret |= (val << (data_width - i - 1));
        }
    }



    if (lframe_val == lframe_active_edge) {
        if (ret == StartEncoding.STOP) {
            lpc_abort = true;
            frame.abort_start_sample = target_sample;
        }
    }
    return ret;
}


//Function called to generate demo siganls (when no physical device is attached)
function on_build_demo_signals() {
    //Use the function below to get the number of samples to be built
    var samples_to_build = ScanaStudio.builder_get_maximum_samples_count();
    //Todo: build the demo signals
}

//Trigger sequence GUI
function on_draw_gui_trigger() {
    //Add gui functions...
}

//Evaluate trigger GUI
function on_eval_gui_trigger() {
    return ""; //All good.
}

//Build trigger sequence
function on_build_trigger() {
    //Add trigger steps here...
}

function format(value, format, width, add_prefix) {
    var pre = "";
    if (add_prefix == undefined) {
        add_prefix = true;
    }
    switch (format) {
        case 0: //dec
            return value.toString(10);
        case 1: //hex
            if (add_prefix) pre = "0x";
            return pre + value.toString(16).lpad("0", width / 4);
            break;
        case 2: //binary
            if (add_prefix) pre = "0b";
            return pre + value.toString(2).lpad("0", width);
            break;
        case 3: //ascii
            return String.fromCharCode(value);
        default:
            return "?";
    }
}

String.prototype.lpad = function (padString, length) {
    var str = this;
    while (str.length < length)
        str = padString + str;
    return str;
}
