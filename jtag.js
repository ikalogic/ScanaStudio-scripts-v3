/* Protocol meta info:
<NAME> JTAG </NAME>
<DESCRIPTION>

</DESCRIPTION>
<VERSION> 0.1 </VERSION>
<AUTHOR_NAME>  Nicolas BASTIT </AUTHOR_NAME>
<AUTHOR_URL> n.bastit@ikalogic.com </AUTHOR_URL>
<COPYRIGHT> Copyright Nicolas BASTIT </COPYRIGHT>
<LICENSE>  This code is distributed under the terms
of the GNU General Public License GPLv3 </LICENSE>
<HELP_URL> https://github.com/ikalogic/ScanaStudio-scripts-v3/wiki/JTAG-ScanaStudio-script-documentation </HELP_URL>
<RELEASE_NOTES>
V0.0:  Initial release.
</RELEASE_NOTES>
*/


//Type "template..." in Atom.io editor (with ScanaStudio plugin) to generate code examples.
function on_draw_gui_decoder()
{
    ScanaStudio.gui_add_ch_selector("ch_tck","TCK (test clock)","TCK");
    ScanaStudio.gui_add_ch_selector("ch_tms","TMS (test mode select)","TMS");
    ScanaStudio.gui_add_ch_selector("ch_tdi","TDI (test data in)","TDI");
    ScanaStudio.gui_add_ch_selector("ch_tdo","TDO (test data out)","TDO");

    ScanaStudio.gui_add_new_tab("Output format",true);
    ScanaStudio.gui_add_check_box("format_hex","HEX",true);
    ScanaStudio.gui_add_check_box("format_ascii","ASCII",false);
    ScanaStudio.gui_add_check_box("format_dec","Unsigned decimal",false);
    ScanaStudio.gui_add_check_box("format_bin","Binary",false);
    ScanaStudio.gui_end_tab();
}

var ch_tck;
var ch_tms;
var ch_tdi;
var ch_tdo;
var format_hex, format_bin, format_ascii, format_dec;

var state_machine;
var trs_tck;
var last_trs_tck;
var next_trs_tck;
var cur_data_in;
var cur_data_in_start_sample;
var cur_data_in_bit_sample = [];
var cur_data_out;
var cur_data_out_start_sample;
var cur_data_out_bit_sample = [];

var margin_tmp = 10;

const   ENUM_TEST_LOGIC_RESET = 0,
ENUM_RUN_TEST_IDLE    = 1,
ENUM_SELECT_DR_SCAN   = 2,
ENUM_CAPTURE_DR       = 3, //DR = Data Register
ENUM_SHIFT_DR         = 4,
ENUM_EXIT_1_DR        = 5,
ENUM_PAUSE_DR         = 6,
ENUM_EXIT_2_DR        = 7,
ENUM_UPDATE_DR        = 8,
ENUM_SELECT_IR_SCAN   = 20, //IR = Instruction Register
ENUM_CAPTURE_IR       = 21,
ENUM_SHIFT_IR         = 22,
ENUM_EXIT_1_IR        = 23,
ENUM_PAUSE_IR         = 24,
ENUM_EXIT_2_IR        = 25,
ENUM_UPDATE_IR        = 26;

function reload_dec_gui_values()
{
    // read GUI values using ScanaStudio.gui_get_value("ID");
    ch_tck =  Number(ScanaStudio.gui_get_value("ch_tck"));
    ch_tms =  Number(ScanaStudio.gui_get_value("ch_tms"));
    ch_tdi =  Number(ScanaStudio.gui_get_value("ch_tdi"));
    ch_tdo =  Number(ScanaStudio.gui_get_value("ch_tdo"));

    format_hex = Number(ScanaStudio.gui_get_value("format_hex"));
    format_dec = Number(ScanaStudio.gui_get_value("format_dec"));
    format_ascii = Number(ScanaStudio.gui_get_value("format_ascii"));
    format_bin = Number(ScanaStudio.gui_get_value("format_bin"));
}


function on_eval_gui_decoder()
{
    var format = Number(ScanaStudio.gui_get_value("format_hex")) + Number(ScanaStudio.gui_get_value("format_dec")) + Number(ScanaStudio.gui_get_value("format_ascii")) + Number(ScanaStudio.gui_get_value("format_bin"));
    if( format == 0 )
    {
        return "Selected at least one kind of output format.";
    }

    var instance_name = "JTAG [";

    var jtag_ch_list = [];
    jtag_ch_list.push(ScanaStudio.gui_get_value("ch_tck"));
    jtag_ch_list.push(ScanaStudio.gui_get_value("ch_tms"));
    jtag_ch_list.push(ScanaStudio.gui_get_value("ch_tdi"));
    jtag_ch_list.push(ScanaStudio.gui_get_value("ch_tdo"));

    ch_list = []; //Global
    var duplicates = false;
    var i;

    for (i=0; i < jtag_ch_list.length; i++)
    {
        if (ch_list[jtag_ch_list[i]] == jtag_ch_list[i])
        {
            return "Error: One or more channels are duplicates.";
        }
        else
        {
            ch_list[jtag_ch_list[i]] = jtag_ch_list[i];
        }
        instance_name += (jtag_ch_list[i] + 1).toString();
        if (i < (jtag_ch_list.length-1))
        {
            instance_name += ",";
        }
    }

    instance_name += "]";

    ScanaStudio.set_script_instance_name(instance_name);
    return "";
}

function add_dec_item_state_machine(start_sample, end_sample, sample_point)
{
    ScanaStudio.dec_item_new(ch_tms, start_sample, end_sample);

    switch(state_machine)
    {
        case ENUM_TEST_LOGIC_RESET:
        {
            ScanaStudio.dec_item_add_content("TEST LOGIC RESET");
            ScanaStudio.dec_item_add_content("TEST RESET");
            ScanaStudio.dec_item_add_content("RESET");
            ScanaStudio.dec_item_add_content("RST");
            break;
        }
        case ENUM_RUN_TEST_IDLE:
        {
            ScanaStudio.dec_item_add_content("RUN TEST IDLE");
            ScanaStudio.dec_item_add_content("RTI");
            break;
        }
        case ENUM_SELECT_DR_SCAN:
        {
            ScanaStudio.dec_item_add_content("SELECT DR SCAN");
            ScanaStudio.dec_item_add_content("SELECT DR");
            ScanaStudio.dec_item_add_content("SEL-DR");
            ScanaStudio.dec_item_add_content("DR");
            break;
        }
        case ENUM_CAPTURE_DR:
        {
            ScanaStudio.dec_item_add_content("CAPTURE DR");
            ScanaStudio.dec_item_add_content("CAP-DR");
            ScanaStudio.dec_item_add_content("CAP");
            break;
        }
        case ENUM_SHIFT_DR:
        {
            ScanaStudio.dec_item_add_content("SHIFT DR");
            ScanaStudio.dec_item_add_content("SHI-DR");
            ScanaStudio.dec_item_add_content("SHI");
            break;
        }
        case ENUM_EXIT_1_DR:
        {
            ScanaStudio.dec_item_add_content("EXIT 1 DR");
            ScanaStudio.dec_item_add_content("EX1-DR");
            ScanaStudio.dec_item_add_content("EX1");
            break;
        }
        case ENUM_PAUSE_DR:
        {
            ScanaStudio.dec_item_add_content("PAUSE DR");
            ScanaStudio.dec_item_add_content("P-DR");
            ScanaStudio.dec_item_add_content("P");
            break;
        }
        case ENUM_EXIT_2_DR:
        {
            ScanaStudio.dec_item_add_content("EXIT 2 DR");
            ScanaStudio.dec_item_add_content("EX2-IR");
            ScanaStudio.dec_item_add_content("EX2");
            break;
        }
        case ENUM_UPDATE_DR:
        {
            ScanaStudio.dec_item_add_content("UPDATE DR");
            ScanaStudio.dec_item_add_content("UP-DR");
            ScanaStudio.dec_item_add_content("UP");
            break;
        }
        case ENUM_SELECT_IR_SCAN:
        {
            ScanaStudio.dec_item_add_content("SELECT IR SCAN");
            ScanaStudio.dec_item_add_content("SELECT IR");
            ScanaStudio.dec_item_add_content("SEL-IR");
            ScanaStudio.dec_item_add_content("IR");
            break;
        }
        case ENUM_CAPTURE_IR:
        {
            ScanaStudio.dec_item_add_content("CAPTURE IR");
            ScanaStudio.dec_item_add_content("CAP-IR");
            ScanaStudio.dec_item_add_content("CAP");
            break;
        }
        case ENUM_SHIFT_IR:
        {
            ScanaStudio.dec_item_add_content("SHIFT IR");
            ScanaStudio.dec_item_add_content("SHI-IR");
            ScanaStudio.dec_item_add_content("SHI");
            break;
        }
        case ENUM_EXIT_1_IR:
        {
            ScanaStudio.dec_item_add_content("EXIT 1 IR");
            ScanaStudio.dec_item_add_content("EX1-IR");
            ScanaStudio.dec_item_add_content("EX1");
            break;
        }
        case ENUM_PAUSE_IR:
        {
            ScanaStudio.dec_item_add_content("PAUSE IR");
            ScanaStudio.dec_item_add_content("P-IR");
            ScanaStudio.dec_item_add_content("P");
            break;
        }
        case ENUM_EXIT_2_IR:
        {
            ScanaStudio.dec_item_add_content("EXIT 2 DR");
            ScanaStudio.dec_item_add_content("EX2-IR");
            ScanaStudio.dec_item_add_content("EX2");
            break;
        }
        case ENUM_UPDATE_IR:
        {
            ScanaStudio.dec_item_add_content("UPDATE IR");
            ScanaStudio.dec_item_add_content("UP-IR");
            ScanaStudio.dec_item_add_content("UP");
            break;
        }
    }
    ScanaStudio.dec_item_add_sample_point(sample_point,"U");
}

function add_dec_item_value_tdio(ch_td, start_sample, end_sample, sample_pt, td_value)
{
    var str_value = "";
    ScanaStudio.dec_item_new(ch_td, start_sample, end_sample);

    if(format_hex)
    {
        str_value += "0x" + td_value.toString(16);
    }
    if(format_ascii)
    {
        str_value += " '" + String.fromCharCode(td_value) + "'";
    }
    if(format_dec)
    {
        str_value += " (" + td_value.toString(10) + ")";
    }
    if(format_bin)
    {
        str_value += " 0b" + td_value.toString(2) ;
    }
    ScanaStudio.dec_item_add_content(str_value);

    for(var i=0; i<sample_pt.length; i++)
    {
        ScanaStudio.dec_item_add_sample_point(sample_pt[i],"P");
    }

}

function on_decode_signals(resume)
{
    var end_reached = false;
    if (!resume) //If resume == false, it's the first call to this function.
    {
        //initialization
        state_machine = ENUM_TEST_LOGIC_RESET;
        reload_dec_gui_values();

        //Reset iterator
        ScanaStudio.trs_reset(ch_tck);
        ScanaStudio.trs_reset(ch_tms);
        ScanaStudio.trs_reset(ch_tdi);
        ScanaStudio.trs_reset(ch_tdo);
        trs_tck = ScanaStudio.trs_get_next(ch_tck);
        next_trs_tck = ScanaStudio.trs_get_next(ch_tck);
        last_trs_tck = ScanaStudio.trs_get_previous(ch_tck);
        last_trs_tck.sample_index = 0;
        last_trs_tck.value = 0;
        next_trs_tck = ScanaStudio.trs_get_next(ch_tck);

        cur_data_in = 0;
        cur_data_in_start_sample = 0;
        cur_data_in_bit_sample = [];

        cur_data_out = 0;
        cur_data_out_start_sample = 0;
        cur_data_out_bit_sample = [];

    }

    while ( (ScanaStudio.abort_is_requested() == false) && (!end_reached) )
    {
        //if last transition reached, do one more time before exiting
        if( !ScanaStudio.trs_is_not_last(ch_tck) )
        {
            //do one more time
            next_trs_tck.sample_index = ScanaStudio.get_available_samples(ch_tck);
            next_trs_tck.value = last_trs_tck.value;
            end_reached = true;
        }


        switch(state_machine)
        {
            case ENUM_TEST_LOGIC_RESET:
            {
                if(trs_tck.value == 0)
                {
                    break;
                }

                if(ScanaStudio.trs_get_before(ch_tms,trs_tck.sample_index).value)
                {
                    state_machine = ENUM_TEST_LOGIC_RESET;
                }
                else
                {
                    state_machine = ENUM_RUN_TEST_IDLE;
                }
                add_dec_item_state_machine( last_trs_tck.sample_index, next_trs_tck.sample_index, trs_tck.sample_index);
                break;
            }


            case ENUM_RUN_TEST_IDLE:
            {
                if(trs_tck.value == 0)
                {
                    break;
                }

                if(ScanaStudio.trs_get_before(ch_tms,trs_tck.sample_index).value)
                {
                    state_machine = ENUM_SELECT_DR_SCAN;
                }
                else
                {
                    state_machine = ENUM_RUN_TEST_IDLE;
                }
                add_dec_item_state_machine( last_trs_tck.sample_index, next_trs_tck.sample_index, trs_tck.sample_index);
                break;
            }


            case ENUM_SELECT_DR_SCAN:
            {
                if(trs_tck.value == 0)
                {
                    break;
                }

                if(ScanaStudio.trs_get_before(ch_tms,trs_tck.sample_index).value)
                {
                    state_machine = ENUM_SELECT_IR_SCAN;
                }
                else
                {
                    state_machine = ENUM_CAPTURE_DR;
                }
                add_dec_item_state_machine( last_trs_tck.sample_index, next_trs_tck.sample_index, trs_tck.sample_index);
                break;
            }


            case ENUM_CAPTURE_DR:
            {
                if(trs_tck.value == 0)
                {
                    break;
                }

                if(ScanaStudio.trs_get_before(ch_tms,trs_tck.sample_index).value)
                {
                    state_machine = ENUM_EXIT_1_DR;
                }
                else
                {
                    state_machine = ENUM_SHIFT_DR;
                    cur_data_out_start_sample = trs_tck.sample_index;
                }
                add_dec_item_state_machine( last_trs_tck.sample_index, next_trs_tck.sample_index, trs_tck.sample_index);
                break;
            }


            case ENUM_SHIFT_DR:
            {
                if(trs_tck.value == 0)
                {
                    if(cur_data_in_bit_sample.length == 0)
                    {
                        cur_data_in_start_sample = trs_tck.sample_index;
                    }
                    cur_data_out_bit_sample.push(trs_tck.sample_index);
                    cur_data_out = cur_data_out<<1;
                    cur_data_out |= ScanaStudio.trs_get_before(ch_tdo, trs_tck.sample_index).value;
                    break;
                }
                else
                {
                    cur_data_in_bit_sample.push(trs_tck.sample_index);
                    cur_data_in = cur_data_in<<1;
                    cur_data_in |= ScanaStudio.trs_get_before(ch_tdi, trs_tck.sample_index).value;
                }

                if(ScanaStudio.trs_get_before(ch_tms,trs_tck.sample_index).value)
                {
                    state_machine = ENUM_EXIT_1_DR;
                    add_dec_item_value_tdio(ch_tdo, cur_data_out_start_sample, trs_tck.sample_index, cur_data_out_bit_sample, cur_data_out);

                    cur_data_out = 0;
                    cur_data_out_start_sample = 0;
                    cur_data_out_bit_sample = [];
                }
                else
                {
                    state_machine = ENUM_SHIFT_DR;
                }
                add_dec_item_state_machine( last_trs_tck.sample_index, next_trs_tck.sample_index, trs_tck.sample_index);
                break;
            }


            case ENUM_EXIT_1_DR:
            {
                if(trs_tck.value == 0)
                {
                    add_dec_item_state_machine( last_trs_tck.sample_index, next_trs_tck.sample_index);
                    if(cur_data_in_bit_sample.length > 0)
                    {
                        add_dec_item_value_tdio(ch_tdi, cur_data_in_start_sample, trs_tck.sample_index, cur_data_in_bit_sample, cur_data_in);

                        cur_data_in = 0;
                        cur_data_in_start_sample = 0;
                        cur_data_in_bit_sample = [];
                    }

                    break;
                }

                if(ScanaStudio.trs_get_before(ch_tms,trs_tck.sample_index).value)
                {
                    state_machine = ENUM_UPDATE_DR;
                }
                else
                {
                    state_machine = ENUM_PAUSE_DR;
                }
                add_dec_item_state_machine( last_trs_tck.sample_index, next_trs_tck.sample_index, trs_tck.sample_index);
                break;
            }


            case ENUM_PAUSE_DR:
            {
                if(trs_tck.value == 0)
                {
                    break;
                }

                if(ScanaStudio.trs_get_before(ch_tms,trs_tck.sample_index).value)
                {
                    state_machine = ENUM_EXIT_2_DR;
                }
                else
                {
                    state_machine = ENUM_PAUSE_DR;
                }
                add_dec_item_state_machine( last_trs_tck.sample_index, next_trs_tck.sample_index, trs_tck.sample_index);
                break;
            }


            case ENUM_EXIT_2_DR:
            {
                if(trs_tck.value == 0)
                {
                    break;
                }

                if(ScanaStudio.trs_get_before(ch_tms,trs_tck.sample_index).value)
                {
                    state_machine = ENUM_UPDATE_DR;
                }
                else
                {
                    state_machine = ENUM_SHIFT_DR;
                    cur_data_out_start_sample = trs_tck.sample_index;
                }
                add_dec_item_state_machine( last_trs_tck.sample_index, next_trs_tck.sample_index, trs_tck.sample_index);
                break;
            }


            case ENUM_UPDATE_DR:
            {
                if(trs_tck.value == 0)
                {
                    break;
                }

                if(ScanaStudio.trs_get_before(ch_tms,trs_tck.sample_index).value)
                {
                    state_machine = ENUM_SELECT_DR_SCAN;
                }
                else
                {
                    state_machine = ENUM_RUN_TEST_IDLE;
                }
                add_dec_item_state_machine( last_trs_tck.sample_index, next_trs_tck.sample_index, trs_tck.sample_index);
                break;
            }


            case ENUM_SELECT_IR_SCAN:
            {
                if(trs_tck.value == 0)
                {
                    break;
                }

                if(ScanaStudio.trs_get_before(ch_tms,trs_tck.sample_index).value)
                {
                    state_machine = ENUM_TEST_LOGIC_RESET;
                }
                else
                {
                    state_machine = ENUM_CAPTURE_IR;
                }
                add_dec_item_state_machine( last_trs_tck.sample_index, next_trs_tck.sample_index, trs_tck.sample_index);
                break;
            }


            case ENUM_CAPTURE_IR:
            {
                if(trs_tck.value == 0)
                {
                    break;
                }

                if(ScanaStudio.trs_get_before(ch_tms,trs_tck.sample_index).value)
                {
                    state_machine = ENUM_EXIT_1_IR;
                }
                else
                {
                    state_machine = ENUM_SHIFT_IR;

                    cur_data_out_start_sample = trs_tck.sample_index;
                }
                add_dec_item_state_machine( last_trs_tck.sample_index, next_trs_tck.sample_index, trs_tck.sample_index);
                break;
            }


            case ENUM_SHIFT_IR:
            {
                if(trs_tck.value == 0)
                {
                    if(cur_data_in_bit_sample.length == 0)
                    {
                        cur_data_in_start_sample = trs_tck.sample_index;
                    }
                    cur_data_out_bit_sample.push(trs_tck.sample_index);
                    cur_data_out = cur_data_out<<1;
                    cur_data_out |= ScanaStudio.trs_get_before(ch_tdo, trs_tck.sample_index).value;
                    break;
                }
                else
                {
                    cur_data_in_bit_sample.push(trs_tck.sample_index);
                    cur_data_in = cur_data_in<<1;
                    cur_data_in |= ScanaStudio.trs_get_before(ch_tdi, trs_tck.sample_index).value;
                }

                if(ScanaStudio.trs_get_before(ch_tms,trs_tck.sample_index).value)
                {
                    state_machine = ENUM_EXIT_1_IR;
                    add_dec_item_value_tdio(ch_tdo, cur_data_out_start_sample, trs_tck.sample_index, cur_data_out_bit_sample, cur_data_out);

                    cur_data_out = 0;
                    cur_data_out_start_sample = 0;
                    cur_data_out_bit_sample = [];
                }
                else
                {
                    state_machine = ENUM_SHIFT_IR;
                }
                add_dec_item_state_machine( last_trs_tck.sample_index, next_trs_tck.sample_index, trs_tck.sample_index);
                break;
            }


            case ENUM_EXIT_1_IR:
            {
                if(trs_tck.value == 0)
                {
                    if(cur_data_in_bit_sample.length > 0)
                    {
                        add_dec_item_value_tdio(ch_tdi, cur_data_in_start_sample, trs_tck.sample_index, cur_data_in_bit_sample, cur_data_in);

                        cur_data_in = 0;
                        cur_data_in_start_sample = 0;
                        cur_data_in_bit_sample = [];
                    }
                    break;
                }

                if(ScanaStudio.trs_get_before(ch_tms,trs_tck.sample_index).value)
                {
                    state_machine = ENUM_UPDATE_IR;
                }
                else
                {
                    state_machine = ENUM_PAUSE_IR;
                }
                add_dec_item_state_machine( last_trs_tck.sample_index, next_trs_tck.sample_index, trs_tck.sample_index);
                break;
            }


            case ENUM_PAUSE_IR:
            {
                if(trs_tck.value == 0)
                {
                    break;
                }

                if(ScanaStudio.trs_get_before(ch_tms,trs_tck.sample_index).value)
                {
                    state_machine = ENUM_EXIT_2_IR;
                }
                else
                {
                    state_machine = ENUM_PAUSE_IR;
                }
                add_dec_item_state_machine( last_trs_tck.sample_index, next_trs_tck.sample_index, trs_tck.sample_index);
                break;
            }


            case ENUM_EXIT_2_IR:
            {
                if(trs_tck.value == 0)
                {
                    break;
                }

                if(ScanaStudio.trs_get_before(ch_tms,trs_tck.sample_index).value)
                {
                    state_machine = ENUM_UPDATE_IR;
                }
                else
                {
                    state_machine = ENUM_SHIFT_IR;
                    cur_data_out_start_sample = trs_tck.sample_index;
                }
                add_dec_item_state_machine( last_trs_tck.sample_index, next_trs_tck.sample_index, trs_tck.sample_index);
                break;
            }


            case ENUM_UPDATE_IR:
            {
                if(trs_tck.value == 0)
                {
                    break;
                }

                if(ScanaStudio.trs_get_before(ch_tms,trs_tck.sample_index).value)
                {
                    state_machine = ENUM_SELECT_DR_SCAN;
                }
                else
                {
                    state_machine = ENUM_RUN_TEST_IDLE;
                }
                add_dec_item_state_machine( last_trs_tck.sample_index, next_trs_tck.sample_index, trs_tck.sample_index);
                break;
            }
        }//end switch

        last_trs_tck = trs_tck;
        trs_tck = next_trs_tck;
        next_trs_tck = ScanaStudio.trs_get_next(ch_tck);
    }//end while
}


function on_build_demo_signals()
{
    var samples_to_build = ScanaStudio.builder_get_maximum_samples_count();
    var jtag_builder = ScanaStudio.BuilderObject;
    jtag_builder.config(
        ScanaStudio.gui_get_value("ch_tck"),
        ScanaStudio.gui_get_value("ch_tms"),
        ScanaStudio.gui_get_value("ch_tdi"),
        ScanaStudio.gui_get_value("ch_tdo"),
        ScanaStudio.builder_get_sample_rate(),
        ScanaStudio.builder_get_sample_rate()/1000  //clock frequency
    );
    jtag_builder.put_silence(0.01);

    while( ScanaStudio.builder_get_samples_acc(ch_tck) < samples_to_build )
    {
        var rng_ir_dr =  Math.floor(Math.random()*3);
        var rng_nbr_data = Math.floor(Math.random()*5) + 1;

        if(rng_ir_dr==0)//IR
        {
            for(var i=0; i<rng_nbr_data; i++)
            {
                jtag_builder.put_IR_data(i,rng_nbr_data-i,8);
            }

            jtag_builder.choose_state_machine_mode(ENUM_TEST_LOGIC_RESET);
            jtag_builder.put_silence(Math.random()*1*0.05);
        }
        else if(rng_ir_dr==1)//DR
        {
            for(var i=0; i<rng_nbr_data; i++)
            {
                jtag_builder.put_DR_data(i,rng_nbr_data-i,8);
            }

            jtag_builder.choose_state_machine_mode(ENUM_TEST_LOGIC_RESET);
            jtag_builder.put_silence(Math.random()*1*0.05);
        }
        else // random state machine
        {
            var rng_state_machine = Math.floor(Math.random()*16);
            if(rng_state_machine>8)
                rng_state_machine+=11;

            jtag_builder.choose_state_machine_mode(rng_state_machine);
            jtag_builder.put_silence(Math.random()*1*0.05);
        }
    }

}


//Builder object that can be shared to other scripts
ScanaStudio.BuilderObject = {

    config : function(ch_tck, ch_tms, ch_tdi, ch_tdo, sample_rate, clk_frequency)
    {
        this.ch_tck = ch_tck;
        this.ch_tms = ch_tms;
        this.ch_tdi = ch_tdi;
        this.ch_tdo = ch_tdo;
        this.sample_rate = sample_rate;
        this.clk_frequency = clk_frequency;
        this.quater_clk = this.sample_rate/this.clk_frequency/4;
        //Set idle states
        this.last_tck = 1;
        this.last_tms = 1;
        this.last_tdi = 1;
        this.last_tdo = 1;
        this.state_machine = ENUM_TEST_LOGIC_RESET;
    },

    put_silence : function (duration_s)
    {
        var samples_count = duration_s*this.sample_rate;
        if (samples_count == 0) samples_count = 1;

        ScanaStudio.builder_add_samples(this.ch_tck, this.last_tck, samples_count);
        ScanaStudio.builder_add_samples(this.ch_tms, this.last_tms, samples_count);
        ScanaStudio.builder_add_samples(this.ch_tdi, this.last_tdi, samples_count);
        ScanaStudio.builder_add_samples(this.ch_tdo, this.last_tdo, samples_count);
    },

    choose_state_machine_mode : function(st_machine)
    {
        var quater_cnt = 0;
        var done_once = false;
        while(  ((this.state_machine != st_machine) || (!done_once)) && (ScanaStudio.builder_get_samples_acc(this.ch_tck) < ScanaStudio.builder_get_maximum_samples_count()) )
        {
            switch(this.state_machine)
            {
                case ENUM_TEST_LOGIC_RESET:
                {
                    switch(quater_cnt)
                    {
                        case 0:
                        {
                            this.set_output(1, this.last_tms, this.last_tdi, this.last_tdo, this.quater_clk);
                            quater_cnt++;
                            break;
                        }
                        case 1:
                        {
                            this.set_output(0, 0, this.last_tdi, this.last_tdo, this.quater_clk);
                            quater_cnt++;
                            break;
                        }
                        case 2:
                        {
                            this.set_output(this.last_tck, this.last_tms, this.last_tdi, this.last_tdo, this.quater_clk);
                            quater_cnt++;
                            break;
                        }
                        case 3:
                        {
                            this.set_output(1, this.last_tms, this.last_tdi, this.last_tdo, this.quater_clk);
                            quater_cnt = 0;
                            this.state_machine = ENUM_RUN_TEST_IDLE;
                            break;
                        }
                    }
                    break;
                }//end ENUM_TEST_LOGIC_RESET

                case ENUM_RUN_TEST_IDLE:
                {
                    switch(quater_cnt)
                    {
                        case 0:
                        {
                            this.set_output(1, this.last_tms, this.last_tdi, this.last_tdo, this.quater_clk);
                            quater_cnt++;
                            break;
                        }
                        case 1:
                        {
                            this.set_output(0, 1, this.last_tdi, this.last_tdo, this.quater_clk);
                            quater_cnt++;
                            break;
                        }
                        case 2:
                        {
                            this.set_output(this.last_tck, this.last_tms, this.last_tdi, this.last_tdo, this.quater_clk);
                            quater_cnt++;
                            break;
                        }
                        case 3:
                        {
                            this.set_output(1, this.last_tms, this.last_tdi, this.last_tdo, this.quater_clk);
                            quater_cnt = 0;
                            this.state_machine = ENUM_SELECT_DR_SCAN;
                            break;
                        }
                    }
                    break;
                }//end ENUM_RUN_TEST_IDLE

                case ENUM_SELECT_DR_SCAN:
                {
                    switch(quater_cnt)
                    {
                        case 0:
                        {
                            this.set_output(1, this.last_tms, this.last_tdi, this.last_tdo, this.quater_clk);
                            quater_cnt++;
                            break;
                        }
                        case 1:
                        {
                            if((st_machine <= ENUM_RUN_TEST_IDLE) || (st_machine >= ENUM_SELECT_IR_SCAN))
                            {
                                this.set_output(0, 1, this.last_tdi, this.last_tdo, this.quater_clk);
                            }
                            else
                            {
                                this.set_output(0, 0, this.last_tdi, this.last_tdo, this.quater_clk);
                            }
                            quater_cnt++;
                            break;
                        }
                        case 2:
                        {
                            this.set_output(this.last_tck, this.last_tms, this.last_tdi, this.last_tdo, this.quater_clk);
                            quater_cnt++;
                            break;
                        }
                        case 3:
                        {
                            this.set_output(1, this.last_tms, this.last_tdi, this.last_tdo, this.quater_clk);
                            quater_cnt = 0;

                            if((st_machine <= ENUM_RUN_TEST_IDLE) || (st_machine >= ENUM_SELECT_IR_SCAN))
                            {
                                this.state_machine = ENUM_SELECT_IR_SCAN;
                            }
                            else
                            {
                                this.state_machine = ENUM_CAPTURE_DR;
                            }
                            break;
                        }
                    }
                    break;
                }//end ENUM_SELECT_DR_SCAN

                case ENUM_CAPTURE_DR:
                case ENUM_SHIFT_DR:
                {
                    switch(quater_cnt)
                    {
                        case 0:
                        {
                            this.set_output(1, this.last_tms, this.last_tdi, this.last_tdo, this.quater_clk);
                            quater_cnt++;
                            break;
                        }
                        case 1:
                        {
                            if(st_machine == ENUM_SHIFT_DR)
                            {
                                this.set_output(0, 0, this.last_tdi, this.last_tdo, this.quater_clk);
                            }
                            else
                            {
                                this.set_output(0, 1, this.last_tdi, this.last_tdo, this.quater_clk);
                            }
                            quater_cnt++;
                            break;
                        }
                        case 2:
                        {
                            this.set_output(this.last_tck, this.last_tms, this.last_tdi, this.last_tdo, this.quater_clk);
                            quater_cnt++;
                            break;
                        }
                        case 3:
                        {
                            quater_cnt = 0;
                            this.set_output(1, this.last_tms, this.last_tdi, this.last_tdo, this.quater_clk);

                            if(st_machine == ENUM_SHIFT_DR)
                            {
                                this.state_machine = ENUM_SHIFT_DR;
                            }
                            else
                            {
                                this.state_machine = ENUM_EXIT_1_DR;
                            }
                            break;
                        }
                    }
                    break;
                }//end ENUM_CAPTURE_DR and ENUM_SHIFT_DR

                case ENUM_EXIT_1_DR:
                {
                    switch(quater_cnt)
                    {
                        case 0:
                        {
                            this.set_output(1, this.last_tms, 1, 1, this.quater_clk);
                            quater_cnt++;
                            break;
                        }
                        case 1:
                        {
                            if( (st_machine == ENUM_PAUSE_DR) || (st_machine == ENUM_EXIT_2_DR) || (st_machine == ENUM_SHIFT_DR) )
                            {
                                this.set_output(0, 0, this.last_tdi, this.last_tdo, this.quater_clk);
                            }
                            else
                            {
                                this.set_output(0, 1, this.last_tdi, this.last_tdo, this.quater_clk);
                            }
                            quater_cnt++;
                            break;
                        }
                        case 2:
                        {
                            this.set_output(this.last_tck, this.last_tms, this.last_tdi, this.last_tdo, this.quater_clk);
                            quater_cnt++;
                            break;
                        }
                        case 3:
                        {
                            this.set_output(1, this.last_tms, this.last_tdi, this.last_tdo, this.quater_clk);
                            quater_cnt = 0;

                            if( (st_machine == ENUM_PAUSE_DR) || (st_machine == ENUM_EXIT_2_DR) || (st_machine == ENUM_SHIFT_DR) )
                            {
                                this.state_machine = ENUM_PAUSE_DR;
                            }
                            else
                            {
                                this.state_machine = ENUM_UPDATE_DR;
                            }
                            break;
                        }
                    }
                    break;
                }//end ENUM_EXIT_1_DR

                case ENUM_PAUSE_DR:
                {
                    switch(quater_cnt)
                    {
                        case 0:
                        {
                            this.set_output(1, this.last_tms, this.last_tdi, this.last_tdo, this.quater_clk);
                            quater_cnt++;
                            break;
                        }
                        case 1:
                        {
                            if(st_machine == ENUM_PAUSE_DR)
                            {
                                this.set_output(0, 0, this.last_tdi, this.last_tdo, this.quater_clk);
                            }
                            else
                            {
                                this.set_output(0, 1, this.last_tdi, this.last_tdo, this.quater_clk);
                            }
                            quater_cnt++;
                            break;
                        }
                        case 2:
                        {
                            this.set_output(this.last_tck, this.last_tms, this.last_tdi, this.last_tdo, this.quater_clk);
                            quater_cnt++;
                            break;
                        }
                        case 3:
                        {
                            this.set_output(1, this.last_tms, this.last_tdi, this.last_tdo, this.quater_clk);
                            quater_cnt = 0;

                            if(st_machine == ENUM_PAUSE_DR)
                            {
                                this.state_machine = ENUM_PAUSE_DR;
                            }
                            else
                            {
                                this.state_machine = ENUM_EXIT_2_DR;
                            }
                            break;
                        }
                    }
                    break;
                }//end ENUM_PAUSE_DR

                case ENUM_EXIT_2_DR:
                {
                    switch(quater_cnt)
                    {
                        case 0:
                        {
                            this.set_output(1, this.last_tms, this.last_tdi, this.last_tdo, this.quater_clk);
                            quater_cnt++;
                            break;
                        }
                        case 1:
                        {
                            if( (st_machine == ENUM_SHIFT_DR) || (st_machine == ENUM_EXIT_1_DR) || (st_machine == ENUM_PAUSE_DR) )
                            {
                                this.set_output(0, 0, this.last_tdi, this.last_tdo, this.quater_clk);
                            }
                            else
                            {
                                this.set_output(0, 1, this.last_tdi, this.last_tdo, this.quater_clk);
                            }
                            quater_cnt++;
                            break;
                        }
                        case 2:
                        {
                            this.set_output(this.last_tck, this.last_tms, this.last_tdi, this.last_tdo, this.quater_clk);
                            quater_cnt++;
                            break;
                        }
                        case 3:
                        {
                            this.set_output(1, this.last_tms, this.last_tdi, this.last_tdo, this.quater_clk);
                            quater_cnt = 0;

                            if( (st_machine == ENUM_SHIFT_DR) || (st_machine == ENUM_EXIT_1_DR) || (st_machine == ENUM_PAUSE_DR) )
                            {
                                this.state_machine = ENUM_SHIFT_DR;
                            }
                            else
                            {
                                this.state_machine = ENUM_UPDATE_DR;
                            }
                            break;
                        }
                    }
                    break;
                }//end ENUM_EXIT_2_DR

                case ENUM_UPDATE_DR:
                {
                    switch(quater_cnt)
                    {
                        case 0:
                        {
                            this.set_output(1, this.last_tms, this.last_tdi, this.last_tdo, this.quater_clk);
                            quater_cnt++;
                            break;
                        }
                        case 1:
                        {
                            if( st_machine == ENUM_RUN_TEST_IDLE )
                            {
                                this.set_output(0, 0, this.last_tdi, this.last_tdo, this.quater_clk);
                            }
                            else
                            {
                                this.set_output(0, 1, this.last_tdi, this.last_tdo, this.quater_clk);
                            }
                            quater_cnt++;
                            break;
                        }
                        case 2:
                        {
                            this.set_output(this.last_tck, this.last_tms, this.last_tdi, this.last_tdo, this.quater_clk);
                            quater_cnt++;
                            break;
                        }
                        case 3:
                        {
                            this.set_output(1, this.last_tms, this.last_tdi, this.last_tdo, this.quater_clk);
                            quater_cnt = 0;

                            if( st_machine == ENUM_RUN_TEST_IDLE )
                            {
                                this.state_machine = ENUM_RUN_TEST_IDLE;
                            }
                            else
                            {
                                this.state_machine = ENUM_SELECT_DR_SCAN;
                            }
                            break;
                        }
                    }
                    break;
                }//end ENUM_UPDATE_DR

                case ENUM_SELECT_IR_SCAN:
                {
                    switch(quater_cnt)
                    {
                        case 0:
                        {
                            this.set_output(1, this.last_tms, this.last_tdi, this.last_tdo, this.quater_clk);
                            quater_cnt++;
                            break;
                        }
                        case 1:
                        {
                            if( st_machine < ENUM_SELECT_IR_SCAN )
                            {
                                this.set_output(0, 1, this.last_tdi, this.last_tdo, this.quater_clk);
                            }
                            else
                            {
                                this.set_output(0, 0, this.last_tdi, this.last_tdo, this.quater_clk);
                            }
                            quater_cnt++;
                            break;
                        }
                        case 2:
                        {
                            this.set_output(this.last_tck, this.last_tms, this.last_tdi, this.last_tdo, this.quater_clk);
                            quater_cnt++;
                            break;
                        }
                        case 3:
                        {
                            this.set_output(1, this.last_tms, this.last_tdi, this.last_tdo, this.quater_clk);
                            quater_cnt = 0;

                            if( st_machine < ENUM_SELECT_IR_SCAN )
                            {
                                this.state_machine = ENUM_TEST_LOGIC_RESET;
                            }
                            else
                            {
                                this.state_machine = ENUM_CAPTURE_IR;
                            }
                            break;
                        }
                    }
                    break;
                }//end ENUM_SELECT_IR_SCAN

                case ENUM_CAPTURE_IR:
                case ENUM_SHIFT_IR:
                {
                    switch(quater_cnt)
                    {
                        case 0:
                        {
                            this.set_output(1, this.last_tms, this.last_tdi, this.last_tdo, this.quater_clk);
                            quater_cnt++;
                            break;
                        }
                        case 1:
                        {
                            if( st_machine == ENUM_SHIFT_IR )
                            {
                                this.set_output(0, 0, this.last_tdi, this.last_tdo, this.quater_clk);
                            }
                            else
                            {
                                this.set_output(0, 1, this.last_tdi, this.last_tdo, this.quater_clk);
                            }
                            quater_cnt++;
                            break;
                        }
                        case 2:
                        {
                            this.set_output(this.last_tck, this.last_tms, this.last_tdi, this.last_tdo, this.quater_clk);
                            quater_cnt++;
                            break;
                        }
                        case 3:
                        {
                            quater_cnt = 0;
                            this.set_output(1, this.last_tms, this.last_tdi, this.last_tdo, this.quater_clk);
                            if( st_machine == ENUM_SHIFT_IR )
                            {
                                this.state_machine = ENUM_SHIFT_IR;
                            }
                            else
                            {
                                this.state_machine = ENUM_EXIT_1_IR;
                            }
                            break;
                        }
                    }
                    break;
                }//end ENUM_CAPTURE_IR and ENUM_SHIFT_IR

                case ENUM_EXIT_1_IR:
                {
                    switch(quater_cnt)
                    {
                        case 0:
                        {
                            this.set_output(1, this.last_tms, 1, 1, this.quater_clk);
                            quater_cnt++;
                            break;
                        }
                        case 1:
                        {
                            if( (st_machine == ENUM_SHIFT_IR) || (st_machine == ENUM_PAUSE_IR) || (st_machine == ENUM_EXIT_2_IR) )
                            {
                                this.set_output(0, 0, this.last_tdi, this.last_tdo, this.quater_clk);
                            }
                            else
                            {
                                this.set_output(0, 1, this.last_tdi, this.last_tdo, this.quater_clk);
                            }
                            quater_cnt++;
                            break;
                        }
                        case 2:
                        {
                            this.set_output(this.last_tck, this.last_tms, this.last_tdi, this.last_tdo, this.quater_clk);
                            quater_cnt++;
                            break;
                        }
                        case 3:
                        {
                            this.set_output(1, this.last_tms, this.last_tdi, this.last_tdo, this.quater_clk);
                            quater_cnt = 0;

                            if( (st_machine == ENUM_SHIFT_IR) || (st_machine == ENUM_PAUSE_IR) || (st_machine == ENUM_EXIT_2_IR) )
                            {
                                this.state_machine = ENUM_PAUSE_IR;
                            }
                            else
                            {
                                this.state_machine = ENUM_UPDATE_IR;
                            }
                            break;
                        }
                    }
                    break;
                }//end ENUM_EXIT_1_IR

                case ENUM_PAUSE_IR:
                {
                    switch(quater_cnt)
                    {
                        case 0:
                        {
                            this.set_output(1, this.last_tms, this.last_tdi, this.last_tdo, this.quater_clk);
                            quater_cnt++;
                            break;
                        }
                        case 1:
                        {
                            if( st_machine == ENUM_PAUSE_IR )
                            {
                                this.set_output(0, 0, this.last_tdi, this.last_tdo, this.quater_clk);
                            }
                            else
                            {
                                this.set_output(0, 1, this.last_tdi, this.last_tdo, this.quater_clk);
                            }
                            quater_cnt++;
                            break;
                        }
                        case 2:
                        {
                            this.set_output(this.last_tck, this.last_tms, this.last_tdi, this.last_tdo, this.quater_clk);
                            quater_cnt++;
                            break;
                        }
                        case 3:
                        {
                            this.set_output(1, this.last_tms, this.last_tdi, this.last_tdo, this.quater_clk);
                            quater_cnt = 0;

                            if( st_machine == ENUM_PAUSE_IR )
                            {
                                this.state_machine = ENUM_PAUSE_IR;
                            }
                            else
                            {
                                this.state_machine = ENUM_EXIT_2_IR;
                            }
                            break;
                        }
                    }
                    break;
                }//end ENUM_PAUSE_IR

                case ENUM_EXIT_2_IR:
                {
                    switch(quater_cnt)
                    {
                        case 0:
                        {
                            this.set_output(1, this.last_tms, this.last_tdi, this.last_tdo, this.quater_clk);
                            quater_cnt++;
                            break;
                        }
                        case 1:
                        {
                            if( (st_machine == ENUM_SHIFT_IR) || (st_machine == ENUM_PAUSE_IR) || (st_machine == ENUM_EXIT_1_IR) )
                            {
                                this.set_output(0, 0, this.last_tdi, this.last_tdo, this.quater_clk);
                            }
                            else
                            {
                                this.set_output(0, 1, this.last_tdi, this.last_tdo, this.quater_clk);
                            }
                            quater_cnt++;
                            break;
                        }
                        case 2:
                        {
                            this.set_output(this.last_tck, this.last_tms, this.last_tdi, this.last_tdo, this.quater_clk);
                            quater_cnt++;
                            break;
                        }
                        case 3:
                        {
                            this.set_output(1, this.last_tms, this.last_tdi, this.last_tdo, this.quater_clk);
                            quater_cnt = 0;

                            if( (st_machine == ENUM_SHIFT_IR) || (st_machine == ENUM_PAUSE_IR) || (st_machine == ENUM_EXIT_1_IR) )
                            {
                                this.state_machine = ENUM_SHIFT_IR;
                            }
                            else
                            {
                                this.state_machine = ENUM_UPDATE_IR;
                            }
                            break;
                        }
                    }
                    break;
                }//end ENUM_EXIT_2_IR

                case ENUM_UPDATE_IR:
                {
                    switch(quater_cnt)
                    {
                        case 0:
                        {
                            this.set_output(1, this.last_tms, this.last_tdi, this.last_tdo, this.quater_clk);
                            quater_cnt++;
                            break;
                        }
                        case 1:
                        {
                            if( st_machine == ENUM_RUN_TEST_IDLE )
                            {
                                this.set_output(0, 0, this.last_tdi, this.last_tdo, this.quater_clk);
                            }
                            else
                            {
                                this.set_output(0, 1, this.last_tdi, this.last_tdo, this.quater_clk);
                            }
                            quater_cnt++;
                            break;
                        }
                        case 2:
                        {
                            this.set_output(this.last_tck, this.last_tms, this.last_tdi, this.last_tdo, this.quater_clk);
                            quater_cnt++;
                            break;
                        }
                        case 3:
                        {
                            this.set_output(1, this.last_tms, this.last_tdi, this.last_tdo, this.quater_clk);
                            quater_cnt = 0;

                            if( st_machine == ENUM_RUN_TEST_IDLE )
                            {
                                this.state_machine = ENUM_RUN_TEST_IDLE;
                            }
                            else
                            {
                                this.state_machine = ENUM_SELECT_DR_SCAN;
                            }
                            break;
                        }
                    }
                    break;
                }//end ENUM_UPDATE_IR

                default:
                    ScanaStudio.console_error_msg("UNKNOWN STATE - it should never happen");
                break;
            }// end switch state_machine

            if(quater_cnt == 0)
            {
                done_once = true;
            }
        }//end while
    },

    set_output : function(tck_out, tms_out, tdi_out, tdo_out, samples_count)
    {
        ScanaStudio.builder_add_samples(this.ch_tck, tck_out, samples_count);
        ScanaStudio.builder_add_samples(this.ch_tms, tms_out, samples_count);
        ScanaStudio.builder_add_samples(this.ch_tdi, tdi_out, samples_count);
        ScanaStudio.builder_add_samples(this.ch_tdo, tdo_out, samples_count);
        this.last_tck = tck_out;
        this.last_tms = tms_out;
        this.last_tdi = tdi_out;
        this.last_tdo = tdo_out;
    },

    put_IR_data : function (data_tdi, data_tdo, data_bit_len)
    {
        for(var i=data_bit_len-1; i>=0; i--)
        {
            this.choose_state_machine_mode(ENUM_SHIFT_IR);
            this.set_output(this.last_tck, this.last_tms, (data_tdi>>i)&0x01, (data_tdo>>i)&0x01, 0);
        }
        this.choose_state_machine_mode(ENUM_EXIT_1_IR);
    },

    put_DR_data : function (data_tdi, data_tdo, data_bit_len)
    {
        for(var i=data_bit_len-1; i>=0; i--)
        {
            this.choose_state_machine_mode(ENUM_SHIFT_DR);
            this.set_output(this.last_tck, this.last_tms, (data_tdi>>i)&0x01, (data_tdo>>i)&0x01, 0);
        }
        this.choose_state_machine_mode(ENUM_EXIT_1_DR);
    }
};
