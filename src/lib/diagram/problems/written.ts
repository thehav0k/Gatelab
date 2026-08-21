import { article, mintermsWhere } from "../builders/kit";
import { muxImplementation } from "../builders/logic";
import {
  describePlan,
  describeSizing,
  memorySizing,
  planExpansion,
} from "../builders/memory";
import { demuxTreeDiagram, priorityEncoderDiagram } from "../builders/selectors";
import {
  rippleCounterDiagram,
  syncCounterDiagram,
} from "../builders/sequential";
import { num, type Problem } from "./types";

/**
 * The questions whose answer is prose, a number, or a comparison.
 *
 * Two rules were applied throughout, and both are worth stating because they are
 * what stops this file being filler:
 *
 *   1. Every NUMBER is computed. Q31 to Q33 run through the same `memorySizing`
 *      and `planExpansion` the connection diagrams use, so the arithmetic in the
 *      written answer cannot disagree with the picture next to it, and changing
 *      the sizes changes both.
 *
 *   2. Every comparison ANSWERS the question rather than listing properties. "Is
 *      a JK flip-flop always better because it is more versatile?" has an answer
 *      — no — and a table of features that leaves the reader to infer it is not
 *      a response to what was asked.
 */

const K = 1024;

export const WRITTEN_PROBLEMS: readonly Problem[] = [
  {
    id: "q1",
    number: "1",
    title: "Digital circuits in modern communication",
    prompt:
      "State the role of digital circuit technology in modern communication systems.",
    category: "theory",
    tags: ["overview", "communication"],
    solve: () => ({
      diagrams: [],
      steps: [
        "The one property that carries everything else: a digital signal can be REGENERATED. An analogue signal that has picked up noise stays noisy forever, and every repeater adds more. A digital signal only has to be distinguishable from its alternative, so a repeater can decide which symbol was sent and transmit a clean copy — noise does not accumulate. That is why a transatlantic fibre link delivers bit-exact data and a transatlantic analogue cable never could.",
        "Error control follows from being discrete. Once the message is a sequence of symbols you can add redundancy with a known structure — parity, Hamming codes, CRC, Reed–Solomon, LDPC — and detect or correct what the channel damaged. There is no analogue equivalent, because there is no way to tell a corrupted voltage from an intended one.",
        "Multiplexing becomes cheap and arbitrary. Time-division multiplexing is a counter and a multiplexer; packet switching is that idea taken to its conclusion. One physical link carries thousands of independent conversations, allocated dynamically, with the routing decided by logic rather than by filters.",
        "Compression only exists in the digital domain. Source coding removes redundancy the receiver can reconstruct — which is what makes video over a phone line possible at all — and it requires the message to be manipulable as data rather than as a waveform.",
        "Encryption, likewise. Confidentiality and authentication are computations on symbols; analogue scrambling is a toy by comparison.",
        "And practically: digital circuits are made of a few standard cells replicated billions of times, so they ride Moore's law, are testable by construction, are reprogrammable in the field (FPGAs, software-defined radio), and do not drift with temperature or age the way an analogue filter does.",
        "The honest caveat: the world is analogue at both ends. Every digital communication system begins and ends with an analogue front end — antenna, amplifier, filter, ADC and DAC — and those parts are where the hard engineering still lives.",
      ],
    }),
  },

  {
    id: "q2",
    number: "2",
    title: "Analogue versus digital circuits",
    prompt:
      "Compare analogue and digital circuits, highlighting their advantages, disadvantages and practical applications.",
    category: "theory",
    tags: ["comparison"],
    solve: () => ({
      diagrams: [],
      tables: [
        {
          title: "Analogue versus digital",
          columns: ["", "Analogue", "Digital"],
          rows: [
            ["Signal", "Continuous in value and time", "Discrete symbols, sampled in time"],
            ["Noise", "Accumulates; every stage degrades it", "Rejected at every regeneration — does not accumulate"],
            ["Accuracy", "Set by component tolerance, drifts with temperature and age", "Set by word length; exactly reproducible"],
            ["Storage", "Degrades (tape, vinyl)", "Copies are bit-exact indefinitely"],
            ["Design", "Every circuit is bespoke; hard to simulate accurately", "A few standard cells composed; simulates exactly"],
            ["Power", "Often lower for a simple task", "Switching and clocking cost power; wins at scale"],
            ["Bandwidth", "Uses the channel directly", "Needs more bandwidth for the same information"],
            ["Latency", "Effectively instantaneous", "Sampling, conversion and processing all add delay"],
            ["Best at", "Sensing, amplification, RF front ends, power", "Computation, storage, control, communication"],
          ],
        },
      ],
      steps: [
        "The real difference is not “continuous versus stepped”. It is that a digital circuit is allowed to DISCARD information: it decides which of a small number of symbols was present and throws the rest away. Everything digital's advantages come from that decision, and so do its disadvantages.",
        "Advantages of digital: noise immunity and regeneration, exact reproducibility, storage without degradation, error detection and correction, programmability, compression, encryption, and a design flow where complexity scales because the parts are identical and composable.",
        "Disadvantages of digital: quantisation error is permanent (once resolution is lost it cannot be recovered), sampling introduces aliasing unless bandwidth is limited first, conversion costs time and power, and switching edges generate electromagnetic interference. A digital solution to a simple analogue problem is usually more expensive.",
        "Advantages of analogue: infinite resolution in principle, no sampling delay, very low power for simple tasks, and it is unavoidable at the interface to the physical world — microphones, sensors, antennas, motors and power supplies are all analogue.",
        "Disadvantages of analogue: noise and drift accumulate, components must be precise and matched, temperature and ageing shift the behaviour, and the design does not compose — putting two analogue blocks together changes both.",
        "In practice almost every real system is a sandwich: analogue front end, ADC, a large digital core, DAC, analogue output stage. A phone, an oscilloscope and a hearing aid are all built this way. The engineering question is never “analogue or digital” but “where should the conversion sit”, and the trend for forty years has been to move it as close to the sensor as possible.",
      ],
    }),
  },

  {
    id: "q3",
    number: "3",
    title: "What logic minimisation actually buys",
    prompt:
      "Analyse the impact of logic minimisation on circuit cost, speed and power consumption.",
    category: "theory",
    tags: ["minimisation", "cost", "power"],
    solve: () => ({
      diagrams: [],
      steps: [
        "COST. Fewer literals means fewer gate inputs; fewer terms means fewer gates. On an IC that is silicon area and therefore yield and price. On a breadboard it is packages — and note the discontinuity: going from five NAND gates to four saves nothing at all, because both fit in one 7400, while going from four to five costs a whole extra chip. Minimising GATES and minimising CHIPS are different objectives, and the second one is what you pay for.",
        "SPEED. A minimal two-level SOP has a fixed depth of two gate delays regardless of the function, so minimisation mostly reduces FAN-IN rather than depth — and wide gates are slow, so that still helps. The larger effect is indirect: fewer gates means fewer loads on each driver, and lower fan-out means faster edges.",
        "POWER. In CMOS, dynamic power is proportional to the number of nodes that switch times the capacitance of each. Fewer gates means fewer switching nodes and less capacitance, so minimisation reduces dynamic power roughly in proportion to gate count. Static leakage scales with transistor count, so it falls too.",
        "But there is a term minimisation makes WORSE. A minimal circuit has unbalanced path delays, which cause glitches — a node that settles to its correct value after transiently switching the other way. Every glitch is dissipated power that computed nothing, and in a large design glitch power can be a significant fraction of the total.",
        "Which is the same mechanism as the static hazard: the redundant consensus term that Quine–McCluskey deletes precisely BECAUSE it is redundant is the one that holds the output steady while the other terms hand over. Delete it and you save a gate and buy a glitch.",
        "So the honest summary: minimisation reliably reduces area and static power, usually reduces dynamic power, has a modest effect on speed, and can slightly increase glitch power. It is a good default, not a universal optimum — see the next question.",
      ],
    }),
  },

  {
    id: "q4",
    number: "4",
    title: "Is fewest gates always best?",
    prompt:
      "Is minimising the number of logic gates always the best optimisation strategy? Explain with examples.",
    category: "theory",
    tags: ["minimisation", "trade-offs", "hazards"],
    solve: () => ({
      diagrams: [],
      steps: [
        "No — and there are at least five concrete situations where the minimal circuit is the wrong one to build.",
        "1. HAZARDS. F = AC′ + BC is minimal and it glitches: with A = B = 1, when C falls, the AC′ term has not yet turned on while the BC term is turning off, and F momentarily drops to 0. Adding the redundant consensus term AB — the very term the minimiser deleted — holds F high through the handover. In a synchronous design the glitch is harmless because nothing samples between edges; driving an asynchronous input, a clock or a set/reset pin, it is a genuine fault.",
        "2. PACKAGE COUNT. A mixed-gate design often uses fewer gates and MORE chips than a NAND-only design, because it needs three different part numbers and you cannot buy a third of a package. Nine gates in three packages beats seven gates in four.",
        "3. REGULARITY. A 16-input function built from one decoder and OR gates is bigger than sixteen minimised SOPs — and it is what everyone builds, because it is one part, it is uniform, and it is trivially changeable. On silicon, PLAs, ROMs and multiplexer trees all deliberately spend area to buy regular layout and short design time.",
        "4. TESTABILITY. Redundant logic is by definition untestable — no input pattern makes the redundancy visible at the output, so a fault inside it cannot be detected. But hazard-free design requires redundancy. These two goals are in direct conflict and you have to choose one.",
        "5. SHARED SUBEXPRESSIONS. Minimising each output of a multi-output circuit separately gives the smallest expression per output and often not the smallest circuit. Deliberately keeping a non-minimal form for two outputs so they can share a gate can win overall — which is why real multi-output minimisation is a different, harder problem.",
        "And a sixth, for completeness: fan-in limits. A minimal 8-literal product term needs an 8-input AND gate. Nobody makes one, so it is built from a tree of smaller gates, which adds depth — and at that point a “less minimal” expression with narrower terms can be faster.",
        "The right framing: minimisation optimises ONE metric (literal count) that is a proxy for the metrics you actually care about. It is an excellent proxy and a bad master.",
      ],
    }),
  },

  {
    id: "q9",
    number: "9",
    title: "Combinational versus sequential logic",
    prompt:
      "Compare combinational and sequential logic circuits with respect to design, operation and applications.",
    category: "theory",
    tags: ["comparison", "state"],
    solve: () => ({
      diagrams: [],
      tables: [
        {
          title: "Combinational versus sequential",
          columns: ["", "Combinational", "Sequential"],
          rows: [
            ["Output depends on", "Present inputs only", "Present inputs AND stored state"],
            ["Memory", "None", "Flip-flops or latches"],
            ["Feedback", "None — the graph is acyclic", "Essential — state feeds back to the logic"],
            ["Clock", "Not required", "Usually required (synchronous)"],
            ["Specified by", "Truth table / Boolean expression", "State diagram / state table"],
            ["Design tools", "K-map, Quine–McCluskey", "State assignment, excitation tables"],
            ["Failure modes", "Static and dynamic hazards", "Setup/hold violations, races, metastability"],
            ["Examples", "Adder, decoder, mux, comparator, ALU", "Counter, register, shift register, controller, memory"],
          ],
        },
      ],
      steps: [
        "The dividing line is exactly one thing: does the circuit's output depend on anything other than its present inputs? If yes, it has state and it is sequential. Everything else follows.",
        "DESIGN. A combinational circuit is fully specified by a truth table, and there is a mechanical procedure — minimise, map to gates — that produces it. A sequential circuit is specified by a state diagram, and the design has extra steps with real choices in them: how many states, how to encode them, which flip-flop type, and what the unused states do.",
        "OPERATION. Combinational logic settles to an answer after a propagation delay and stays there. Sequential logic advances through a sequence, one state per clock edge, so its timing has TWO constraints rather than one — data must arrive before the setup time and stay until after the hold time, which is what sets the maximum clock frequency.",
        "The failure modes differ completely. A combinational circuit fails by glitching; a sequential circuit fails by sampling at the wrong moment — setup violations, hold violations, and metastability when an asynchronous input changes right at the clock edge.",
        "APPLICATIONS. Anything that transforms data uses combinational logic: adders, ALUs, decoders, multiplexers, encoders, comparators. Anything that remembers or sequences uses sequential logic: counters, registers, shift registers, memory, and every controller and state machine.",
        "And they are not alternatives. Every real system is combinational logic between banks of flip-flops — that is what a synchronous design IS. The flip-flops break the circuit into stages so that only one stage's propagation delay has to fit inside one clock period.",
      ],
    }),
  },

  {
    id: "q11",
    number: "11",
    title: "Two inputs active on a standard encoder",
    prompt:
      "A standard 8-to-3 encoder receives two active inputs simultaneously. What output will it produce, and why is this a problem?",
    category: "theory",
    tags: ["encoder", "priority", "ambiguity"],
    params: [{ key: "bits", label: "Encoder output bits", kind: "int", min: 2, max: 3, initial: 3 }],
    solve: (v) => {
      const bits = num(v, "bits", 3);
      const n = 1 << bits;
      const rows: string[][] = [];
      for (const [a, b] of [
        [3, 5],
        [1, 2],
        [n - 1, 1],
      ] as const) {
        if (a >= n || b >= n) continue;
        const or = a | b;
        rows.push([
          `D${a} and D${b}`,
          a.toString(2).padStart(bits, "0"),
          b.toString(2).padStart(bits, "0"),
          or.toString(2).padStart(bits, "0"),
          `${or} — which is neither`,
        ]);
      }
      return {
        diagrams: [
          priorityEncoderDiagram({
            bits,
            id: "q11",
            title: `${n}-to-${bits} PRIORITY encoder — the fix`,
          }),
        ],
        tables: [
          {
            title: "What a plain encoder does with two active inputs",
            columns: ["active inputs", "code of one", "code of the other", "actual output", "meaning"],
            rows,
          },
        ],
        answer: `It outputs the bitwise OR of the two codes — a third, valid-looking code that means neither input.`,
        steps: [
          `A standard encoder is built as ${bits} OR gates: output bit k is the OR of every input whose index has bit k set. There is nothing in it that even notices how many inputs are active.`,
          "So with two inputs active it produces the bitwise OR of their two codes. The output is not garbage, not floating and not obviously wrong — it is a perfectly valid code for a THIRD input that is not active at all.",
          `Example: D3 (011) and D5 (101) active together give 111, which reads as D7. A downstream circuit will act on interrupt 7, which nobody requested, and neither of the two real requests is served.`,
          "That is what makes it dangerous rather than merely incorrect. A wrong answer that is detectably wrong is a nuisance; a wrong answer indistinguishable from a right one is a bug that ships.",
          "There is a second ambiguity even with ONE active input: all inputs low also produces 000, which is indistinguishable from D0 active. A valid output V is needed to tell them apart.",
          "The fix is a PRIORITY encoder: each input is ANDed with the complement of every higher-numbered input, so only the highest active one reaches the output gates. The drawing above shows exactly that masking, plus the V output.",
        ],
      };
    },
  },

  {
    id: "q14",
    number: "14",
    title: "The multiplexer as a universal logic element",
    prompt: "Explain how a multiplexer can be used as a universal logic circuit.",
    category: "theory",
    tags: ["multiplexer", "Shannon expansion", "universality"],
    params: [
      { key: "bits", label: "Variables in the example", kind: "int", min: 2, max: 4, initial: 3 },
    ],
    solve: (v) => {
      const bits = num(v, "bits", 3);
      const variables = ["A", "B", "C", "D"].slice(0, bits);
      const spec = {
        name: "F",
        variables,
        minterms: mintermsWhere(bits, (m) => m % 3 === 1),
      };
      return {
        diagrams: [
          muxImplementation(spec, {
            id: "q14",
            title: `Any ${bits}-variable function on one ${1 << (bits - 1)}-to-1 multiplexer`,
            selectBits: bits - 1,
          }),
        ],
        steps: [
          "Two different senses of “universal”, and it is worth separating them.",
          "First: a 2ⁿ-to-1 multiplexer with the n variables on its select lines and the truth-table column tied to its data inputs implements ANY n-variable function. The multiplexer is literally reading the truth table out — data input k IS row k. This is universal but wasteful: 2ⁿ data inputs for an n-variable function.",
          "Second, and the one that matters: a 2ⁿ⁻¹-to-1 multiplexer is enough. Put n−1 variables on the select lines; fixing them leaves a function of the ONE remaining variable, and a function of one variable can only be 0, 1, that variable, or its complement. So each data input is tied to one of four things, read straight off the truth table two rows at a time. Half the multiplexer, one inverter at most.",
          "The underlying principle is Shannon expansion: F(A,B,…) = A′·F(0,B,…) + A·F(1,B,…). A multiplexer is exactly that identity in hardware, with the select line as A and the two cofactors as the data inputs. Applying it repeatedly gives the tree of 2-to-1 multiplexers that implements any function with no gates at all.",
          "That is also why an FPGA logic cell is a small multiplexer with SRAM cells on its data inputs: a 6-input look-up table is a 64-to-1 multiplexer, and it can be made into any 6-input function by writing 64 bits — no rewiring. The universality of the multiplexer is the reason field-programmable logic exists.",
          "Compare the alternatives: NAND is universal in the sense that you can BUILD any gate from it; a multiplexer is universal in the sense that ONE of them, unmodified, becomes any function you like just by changing what is tied to its inputs. That is a much stronger and more useful kind of universality.",
        ],
      };
    },
  },

  {
    id: "q16",
    number: "16",
    title: "Where a priority encoder is required",
    prompt:
      "Give a real-life application where a priority encoder is preferred over a standard encoder.",
    category: "theory",
    tags: ["priority encoder", "interrupts"],
    solve: () => ({
      diagrams: [],
      steps: [
        "INTERRUPT CONTROLLERS are the canonical case, and they are the reason the part exists. A processor has one interrupt input and many devices that can request service. Each device raises a line; the controller must tell the processor WHICH to serve.",
        "Two devices interrupting in the same instant is not an edge case — it is routine, and at some request rate it becomes common. A standard encoder would OR the two codes and hand the processor a vector for a third device, which would run the wrong service routine and leave both real requests pending. That is a hang, not a glitch.",
        "A priority encoder resolves it correctly and, more importantly, DELIBERATELY: the highest-priority device wins, its vector is emitted, it is served, and the lower request is still asserted so it is served on the next cycle. Nothing is lost and the ordering is a design decision rather than an accident.",
        "The priority ordering itself carries engineering meaning. A power-fail warning outranks a disk transfer, which outranks a keystroke — because the consequences of being late differ by orders of magnitude. Encoding that ordering in hardware is the point.",
        "Other real cases with the same shape: keypad scanning, where two keys pressed together must produce one defined keycode rather than a phantom third; ADC flash converters, where the thermometer-code comparator outputs are all high up to the input level and a priority encoder finds the topmost one; bus arbitration between masters; and finding the highest set bit of a word, which is a priority encoder in hardware and `clz` in an instruction set.",
        "The general rule: use a priority encoder whenever simultaneous inputs are POSSIBLE and the response must remain well-defined. Use a standard encoder only when the inputs are mutually exclusive by construction — for instance when they come from a decoder, which can only ever raise one line.",
      ],
    }),
  },

  {
    id: "q17",
    number: "17",
    title: "Decoder versus demultiplexer",
    prompt:
      "Compare a decoder with a demultiplexer. Under what conditions can a decoder function as a demultiplexer?",
    category: "theory",
    tags: ["decoder", "demultiplexer", "enable"],
    solve: () => ({
      diagrams: [
        demuxTreeDiagram({
          selectBits: 2,
          stageBits: 2,
          data: true,
          id: "q17",
          title: "One box, two names — the enable pin is the difference",
        }),
      ],
      tables: [
        {
          title: "Same silicon, different reading",
          columns: ["", "Decoder", "Demultiplexer"],
          rows: [
            ["Address inputs", "n address lines", "n select lines"],
            ["Extra input", "Enable (on/off)", "Data (the thing being routed)"],
            ["Outputs", "2ⁿ, one active", "2ⁿ, one carries the data"],
            ["Output k", "minterm(k) · E", "minterm(k) · D"],
            ["Purpose", "Convert a code to a one-hot line", "Route one signal to one of many destinations"],
          ],
        },
      ],
      answer:
        "A decoder WITH AN ENABLE INPUT is already a demultiplexer: feed the data into the enable.",
      steps: [
        "Write down what output k of an enabled decoder is: minterm(k) of the address, ANDed with the enable. Now write down what output k of a demultiplexer is: minterm(k) of the select lines, ANDed with the data. They are the same expression. The parts are electrically identical.",
        "The difference is entirely in how the extra input is USED. Call it “enable” and hold it static, and you have a decoder that converts a binary code into a one-hot line. Vary it with your data, and the same circuit steers that data onto one of 2ⁿ outputs — a demultiplexer.",
        "So the condition is simply: a decoder can act as a demultiplexer if and only if it HAS an enable input, and you connect the data to it. A decoder without an enable cannot, because there is nowhere for the data to enter.",
        "Manufacturers acknowledge this openly. The 74138 is sold as a “3-to-8 decoder/demultiplexer” on the same datasheet, and the 74155 is documented both ways. There is no second design.",
        "One practical asymmetry: many decoders have ACTIVE-LOW outputs and multiple enables (the 74138 has three, two active low and one active high). Used as a demultiplexer, the data therefore appears INVERTED on the selected output, and the unselected outputs sit HIGH rather than low. That catches people out and is worth stating in an answer.",
        "The converse is not symmetric: a demultiplexer is always usable as a decoder — tie its data input active and it decodes — but a plain decoder without an enable is not usable as a demultiplexer at all.",
      ],
    }),
  },

  {
    id: "q19",
    number: "19",
    title: "When to choose D over JK",
    prompt:
      "Under what conditions would you choose a D flip-flop instead of a JK flip-flop? Justify your answer.",
    category: "theory",
    tags: ["flip-flop", "design"],
    solve: () => ({
      diagrams: [],
      steps: [
        "Choose D whenever the job is to STORE a value, which is the overwhelming majority of the time. Q⁺ = D: what you present is what you get. Registers, pipeline stages, data paths, and every flip-flop inside an FPGA are D types for this reason.",
        "Choose D when the next-state logic is being derived automatically or from an equation. For a D flip-flop the excitation IS the next-state function — D = Q⁺ — so there is no excitation table, no characteristic equation, and no second chance to make a sign error. For a JK you must derive TWO functions per flip-flop from the excitation table, and every one of those derivations is an opportunity to be wrong.",
        "Choose D for silicon area and pin count. A D flip-flop is smaller and has one data input rather than two, which matters when there are a million of them and when the routing to reach them is the expensive part.",
        "Choose D for predictable timing: one input means one setup/hold path to close, not two.",
        "The classical argument FOR JK was gate count. Its don't-cares in the excitation table often produce simpler next-state logic than a D implementation of the same machine, which was decisive when gates were expensive relative to flip-flops. That economics reversed decades ago — in a modern process, flip-flops are cheap and the wiring between them is the constraint — so the argument no longer holds.",
        "JK still earns its place for TOGGLING: with J = K = 1 it inverts on every clock, which makes ripple and toggle counters trivial. A D flip-flop needs Q′ fed back to D to do the same thing, which is an extra wire and, in some technologies, an extra inverter. (A T flip-flop is a JK with its inputs tied, and is the honest part to use if toggling is all you need.)",
        "The summary: D for storage and for anything derived from equations; JK or T when the natural description of the behaviour is “toggle”; and if in doubt, D — the simpler excitation is worth more than the gate it might have saved.",
      ],
    }),
  },

  {
    id: "q20",
    number: "20",
    title: "SR, JK, D and T compared",
    prompt:
      "Compare SR, JK, D and T flip-flops in terms of functionality, complexity and typical applications.",
    category: "theory",
    tags: ["flip-flop", "comparison"],
    solve: () => ({
      diagrams: [],
      tables: [
        {
          title: "Characteristic behaviour",
          columns: ["Type", "Inputs", "Characteristic equation", "Forbidden / special", "Typical use"],
          rows: [
            ["SR", "S, R", "Q⁺ = S + R′Q", "S = R = 1 is FORBIDDEN", "Latches, debounce, bus arbitration"],
            ["JK", "J, K", "Q⁺ = JQ′ + K′Q", "J = K = 1 toggles (the fix for SR)", "Counters, general state machines"],
            ["D", "D", "Q⁺ = D", "None — every input is legal", "Registers, pipelines, data storage"],
            ["T", "T", "Q⁺ = T ⊕ Q", "None", "Binary counters, frequency division"],
          ],
        },
        {
          title: "Excitation tables — what to apply to get the transition you want",
          columns: ["Q → Q⁺", "S R", "J K", "D", "T"],
          rows: [
            ["0 → 0", "0 X", "0 X", "0", "0"],
            ["0 → 1", "1 0", "1 X", "1", "1"],
            ["1 → 0", "0 1", "X 1", "0", "1"],
            ["1 → 1", "X 0", "X 0", "1", "0"],
          ],
          note: "X is a don't-care, and those don't-cares are exactly why JK often yields simpler next-state logic than D.",
        },
      ],
      steps: [
        "SR is the primitive — two cross-coupled NAND or NOR gates — and every other type is built from it. Its flaw is structural, not incidental: S = R = 1 tells the latch to set and reset simultaneously, and when both inputs are released the final state depends on which gate is faster. That is a race with no defined winner.",
        "JK is SR with the forbidden state repurposed. Feeding Q and Q′ back into the input gates makes J = K = 1 mean TOGGLE instead of “undefined”, so every one of the four input combinations now has a defined meaning. It is the most versatile of the four.",
        "D is SR with R tied to S′, which makes the forbidden combination unreachable by construction rather than by discipline. One input, no illegal states, and the excitation equals the next state — which is why it is what almost everything is built from today.",
        "T is JK with J and K tied together. It toggles or holds, which is precisely what each stage of a binary counter has to do.",
        "COMPLEXITY, in transistors: D is smallest, T is next, SR is comparable, JK is largest (it needs the feedback of Q and Q′ into the input stage). In DESIGN effort the order is nearly reversed: D takes no derivation at all, T takes one XOR of thought, and JK takes two functions per flip-flop out of the excitation table.",
        "One timing caveat that belongs in any answer about JK: with J = K = 1 a LEVEL-triggered JK toggles continuously for as long as the clock is high — “racing round”. That is why every practical JK is edge-triggered or master-slave, and it is a failure mode D simply does not have.",
        "In practice: D for storage, T for counters, JK when the machine's description is naturally in terms of set/reset/toggle, and SR essentially only as a latch or inside the others.",
      ],
    }),
  },

  {
    id: "q21",
    number: "21",
    title: "Edge-triggered versus level-triggered",
    prompt:
      "Compare edge-triggered and level-triggered flip-flops. Which is more suitable for high-speed applications, and why?",
    category: "theory",
    tags: ["timing", "flip-flop", "transparency"],
    solve: () => ({
      diagrams: [],
      answer: "Edge-triggered — because its data window is a moment, not an interval.",
      steps: [
        "A level-triggered device (a latch) is TRANSPARENT while its enable is asserted: the output follows the input continuously for the whole of that time. An edge-triggered device samples at one instant — the rising or falling transition — and ignores its input entirely otherwise.",
        "Transparency is the problem. If a latch is open while its own output propagates through logic and comes back to its input, the data races round the loop and the state at the closing edge depends on propagation delays rather than on the design. That is why you cannot build a shift register from single latches: the first bit runs straight through all of them in one clock phase.",
        "Edge triggering eliminates that by construction. The sampling window is a moment, so a flip-flop's output cannot affect its own input within the same clock cycle no matter how fast the logic is. This is what makes the standard synchronous design discipline — logic between flip-flops, one clock — actually work.",
        "For HIGH SPEED, edge triggering wins for three reasons. First, the entire clock period is available for logic to settle, whereas a latch-based design must keep the logic delay outside the transparent window. Second, timing analysis becomes a simple inequality: t_logic + t_setup + t_skew ≤ t_period, checkable mechanically for a million paths. Third, clock duty cycle stops mattering — a latch design depends on the width of the high phase, an edge design only on the interval between edges.",
        "The honest counter-argument: latch-based design can be FASTER at the very top end, because of TIME BORROWING. A signal that arrives a little late into a transparent latch still propagates immediately, so a slow stage can borrow slack from its neighbour. Some high-performance processors are built this way. It is much harder to analyse and to verify, which is why it is the exception.",
        "So: edge-triggered for essentially all designs, and level-triggered only where transparency is what you want — inside a master-slave pair, in low-power clock gating, or where a designer has deliberately taken on the complexity of time borrowing.",
      ],
    }),
  },

  {
    id: "q22",
    number: "22",
    title: "Is a JK flip-flop always the better choice?",
    prompt:
      "Is a JK flip-flop always a better choice because it is more versatile? Defend your answer.",
    category: "theory",
    tags: ["flip-flop", "critical analysis"],
    solve: () => ({
      diagrams: [],
      answer: "No. Versatility is a cost as often as it is a benefit.",
      steps: [
        "The premise is true and the conclusion does not follow. A JK IS more versatile — all four input combinations are meaningful, and it subsumes SR, D and T. But versatility means more inputs, and more inputs means more of everything that costs.",
        "MORE LOGIC TO DERIVE. A JK needs TWO excitation functions per flip-flop; a D needs one, and that one is the next-state function itself. For an n-state machine that is 2n derivations from an excitation table instead of n readings from the state table — twice the work and twice the chance of an error, for a saving in gates that stopped mattering when gates stopped being the expensive part.",
        "MORE HARDWARE. A JK is larger than a D in transistor count, has an extra input pin to route, and presents two timing paths to close instead of one. In a design with a hundred thousand flip-flops that is a real area and routing cost.",
        "A FAILURE MODE D DOES NOT HAVE. With J = K = 1, a level-triggered or master-slave JK will toggle repeatedly while the clock is high — the “race-around” condition. It is solved by edge triggering, but it is a hazard that exists only because the toggle capability exists.",
        "AND THE ECONOMICS REVERSED. The classical case for JK was that its excitation don't-cares produce simpler next-state logic. That was decisive when a flip-flop cost more than several gates. In a modern process a flip-flop is cheap and the interconnect between flip-flops is the constraint, so trading flip-flop simplicity for gate simplicity is trading the wrong way round.",
        "The evidence is in what actually gets built. FPGA logic cells contain D flip-flops. Standard cell libraries are dominated by D flip-flops. Processor register files are D flip-flops. If JK were simply better, that is not what would be in the silicon.",
        "Where JK genuinely wins: when the behaviour you are describing is naturally set/reset/toggle — counters, toggling control bits — and when you are hand-minimising a small machine and the don't-cares really do collapse the logic. Both are real; neither is “always”.",
        "The general principle worth taking away: choosing the most capable component available is not optimisation. The right component is the least capable one that does the job, because every unused capability is paid for in area, in pins, in verification and in the failure modes it brings with it.",
      ],
    }),
  },

  {
    id: "q23",
    number: "23",
    title: "Synchronous versus asynchronous design",
    prompt:
      "Under what circumstances would you choose a synchronous design over an asynchronous design? Justify your answer.",
    category: "theory",
    tags: ["synchronous", "asynchronous", "design"],
    solve: () => ({
      diagrams: [],
      steps: [
        "Choose synchronous by default, and treat asynchronous as a decision requiring justification. That is the industry position and it is not fashion — it is about what can be VERIFIED.",
        "The reason is timing analysis. In a synchronous design, correctness reduces to one inequality per path: the logic delay plus setup time plus clock skew must fit inside the clock period. A tool checks that for millions of paths automatically. In an asynchronous design, correctness depends on the relative ordering of events with no reference, so every possible ordering has to be reasoned about — and the state space of orderings is exponential.",
        "Choose synchronous when: the design is large; more than one person works on it; it must be tested by scan chains (which need a common clock); it must be portable to a different process or FPGA (asynchronous designs depend on delays that change); or the specification will change (a synchronous design tolerates re-timing, an asynchronous one is re-verified from scratch).",
        "Choose asynchronous when: speed must not be limited by the worst-case path (an asynchronous circuit completes as fast as the actual data allows, not as slowly as the slowest possible case); average power must be minimal (no clock means no switching when idle, which is why smart cards and some low-power radios use it); electromagnetic emissions must be spread rather than concentrated at the clock frequency; or the circuit is genuinely tiny — a handful of gates does not need a clock tree.",
        "There is also the unavoidable case: the boundary. Any signal entering a synchronous system from outside — a button, a sensor, another clock domain — is asynchronous by definition, and it can violate setup and hold no matter what you do. The answer is a SYNCHRONISER, two flip-flops in series, which does not eliminate metastability but makes its probability negligible. Every synchronous design has an asynchronous edge, and that edge is where the bugs live.",
        "The cost of synchronous, stated fairly: the clock distribution network can consume a large fraction of total power, every path is slowed to the worst case, and a clock tree on a large chip is itself a hard engineering problem. These are real costs, willingly paid, because the alternative is a design nobody can prove correct.",
      ],
    }),
  },

  {
    id: "q24",
    number: "24",
    title: "When an asynchronous counter is the better choice",
    prompt:
      "Under what circumstances would an asynchronous counter be a better choice than a synchronous counter?",
    category: "theory",
    tags: ["counter", "ripple", "trade-offs"],
    solve: () => ({
      diagrams: [
        rippleCounterDiagram({ bits: 4, id: "q24", title: "Ripple counter — no gates at all" }),
      ],
      steps: [
        "FREQUENCY DIVISION. This is the strongest case. If all you want is a clock at f/2ⁿ, you take the last output and never look at the intermediate ones — so the ripple delay, which is the ripple counter's whole problem, is invisible. A crystal oscillator divided down to a real-time-clock tick is exactly this, and it is done with a ripple counter.",
        "SIMPLICITY AND PART COUNT. A ripple counter is n flip-flops and nothing else — no AND chain, no carry logic. Fewer gates, less area, fewer things to get wrong.",
        "POWER. On each clock edge, only bit 0 always toggles; bit 1 toggles half as often, bit 2 a quarter as often. A synchronous counter clocks every flip-flop every cycle whether it changes or not, so it burns clock power on all n. For a long-running, low-speed counter the ripple version can use a small fraction of the power.",
        "LOW SPEED. If the clock is slow enough that the total ripple delay is a negligible fraction of the period, the disadvantage simply does not arise. A counter clocked at 1 kHz does not care about 40 ns of ripple.",
        "EVENT COUNTING WITH A READ STROBE. If the count is only read when the input is known to be idle, the transient invalid states never appear at the moment of reading.",
        "When NOT to: any time the outputs are DECODED. Going from 0111 to 1000, a ripple counter genuinely passes through 0110, 0100 and 0000, and a decoder watching those lines will pulse the wrong output. That is the classic bug, and the reason synchronous counters exist.",
        "Also never at high speed: the maximum frequency is 1/(n·t_pd) rather than 1/t_pd, so the counter gets slower with every bit added. Above a few megahertz, or above a few bits, use a synchronous counter.",
      ],
    }),
  },

  {
    id: "q25",
    number: "25",
    title: "Why processors use synchronous counters",
    prompt: "Why are synchronous counters preferred in modern high-speed processors?",
    category: "theory",
    tags: ["counter", "speed"],
    solve: () => ({
      diagrams: [
        syncCounterDiagram({ bits: 4, id: "q25", title: "Synchronous counter — constant delay" }),
      ],
      steps: [
        "SPEED THAT DOES NOT DEGRADE WITH WIDTH. In a synchronous counter every flip-flop sees the same clock edge, so the total delay is one flip-flop plus one carry gate — independent of how many bits there are. A ripple counter's delay is n flip-flop delays. At a 3 GHz clock the period is about 330 ps, which is a couple of gate delays in total; a 32-bit ripple counter would need tens of nanoseconds and is simply impossible.",
        "OUTPUTS THAT ARE ALWAYS VALID. All bits change together, so the outputs never pass through an intermediate state. A program counter feeds an address decoder and a cache tag comparator directly; if it transiently showed a wrong address, the processor would fetch from it. There is no time to wait for a ripple to settle.",
        "STATIC TIMING ANALYSIS. A processor's timing is signed off by a tool that checks every path against the clock period. A synchronous counter is an ordinary synchronous block and analyses like any other. A ripple counter uses flip-flop OUTPUTS as clocks, which creates n separate clock domains, each skewed from the last — untimeable in practice and a nightmare for clock-tree synthesis.",
        "TESTABILITY. Production test uses scan chains, which require every flip-flop to be on the same controllable clock. A ripple counter's internal flip-flops are clocked by data, so they cannot be scanned, and the block becomes a hole in the test coverage.",
        "PREDICTABLE, ANALYSABLE POWER AND NOISE. Everything switches at the clock edge, in a window the power distribution network is designed for, rather than smeared across a ripple interval.",
        "And when the carry chain itself becomes the limit — a 64-bit synchronous counter's AND chain is long — the answer is not to go back to ripple, it is carry-lookahead or a pipelined/segmented counter. The synchronous discipline is kept and the carry is made faster within it.",
      ],
    }),
  },

  {
    id: "q26",
    number: "26",
    title: "Synchronous counters and their trade-offs",
    prompt:
      "Why are synchronous counters generally preferred over asynchronous counters in high-speed digital systems? Discuss the trade-offs involved.",
    category: "theory",
    tags: ["counter", "trade-offs"],
    solve: () => ({
      diagrams: [],
      tables: [
        {
          title: "The trade",
          columns: ["", "Asynchronous (ripple)", "Synchronous"],
          rows: [
            ["Clocking", "Each stage clocked by the previous", "All stages on one clock"],
            ["Delay", "n × t_pd — grows with width", "t_pd + t_gate — constant"],
            ["Max frequency", "1 / (n · t_pd)", "≈ 1 / t_pd"],
            ["Invalid states", "Yes, after every edge", "None"],
            ["Extra logic", "None", "Carry AND chain"],
            ["Clock power", "Only bit 0 sees the full rate", "Every flip-flop clocked every cycle"],
            ["Timing analysis", "Effectively impossible", "Standard and automatic"],
            ["Testability", "Not scannable", "Fully scannable"],
          ],
        },
      ],
      steps: [
        "The preference is real but it is a TRADE, and stating it as a pure win misses what the question is asking.",
        "What synchronous buys: constant delay independent of width, outputs that are never transiently wrong, standard static timing analysis, scan testability, and a single clean clock domain.",
        "What it costs: the AND chain that computes the toggle conditions (area and, at 64 bits, its own delay problem), clock power on every flip-flop every cycle whether it changes or not, and the clock distribution network itself — which on a large chip is a significant fraction of total power and one of the hardest parts of the physical design.",
        "The trade-off resolves overwhelmingly toward synchronous at high speed because the ripple counter's cost is not merely bad, it is DISQUALIFYING. Invalid intermediate states cannot be tolerated by anything that decodes the outputs, and a flip-flop clocked by data cannot be timed or scanned. Those are not points on a spectrum; they rule the design out.",
        "At low speed the trade genuinely reverses, and it is worth saying so: a battery-powered real-time clock divider is a ripple counter precisely because clocking thirty-two flip-flops at the crystal frequency would dominate its power budget.",
        "There is a middle option worth knowing: a hybrid, where the counter is split into synchronous blocks that ripple between them. The top block only advances when the bottom rolls over, so it is clocked rarely — recovering most of the power saving while keeping each block analysable.",
      ],
    }),
  },

  {
    id: "q27",
    number: "27",
    title: "Ripple versus synchronous counters",
    prompt:
      "Compare ripple counters and synchronous counters in terms of speed, complexity, power consumption and applications.",
    category: "theory",
    tags: ["counter", "comparison"],
    solve: () => ({
      diagrams: [
        rippleCounterDiagram({ bits: 4, id: "q27a", title: "Ripple counter" }),
        syncCounterDiagram({ bits: 4, id: "q27b", title: "Synchronous counter" }),
      ],
      tables: [
        {
          title: "Head to head",
          columns: ["", "Ripple", "Synchronous"],
          rows: [
            ["Speed", "n · t_pd; degrades with every bit", "t_pd + t_gate; constant"],
            ["Complexity", "n flip-flops, no gates", "n flip-flops plus a carry chain"],
            ["Switching power", "Bit k toggles at f/2^k — low total activity", "Same output activity"],
            ["Clock power", "Only bit 0 sees the full clock rate", "All n flip-flops clocked at full rate"],
            ["Output validity", "Invalid for n · t_pd after each edge", "Always valid"],
            ["Glitches when decoded", "Yes — spurious decoder outputs", "No"],
            ["Timing analysis", "Impractical (n clock domains)", "Standard"],
            ["Applications", "Frequency division, slow event counting", "Processors, timers, anything decoded"],
          ],
        },
      ],
      steps: [
        "SPEED. A ripple counter's clock edge has to pass through every flip-flop in turn, so its delay is n·t_pd and its maximum frequency falls as it gets wider. A synchronous counter's delay is one flip-flop plus one gate regardless of width.",
        "COMPLEXITY. The ripple counter is as simple as a counter can be: n flip-flops with J = K = 1 and no other components. The synchronous one adds an AND chain so that bit k toggles only when every lower bit is 1 — more gates, and at large widths that chain needs lookahead of its own.",
        "POWER. The counting activity is identical (bit k toggles at f/2^k in both). The difference is the CLOCK: a ripple counter presents the full-rate clock to only one flip-flop, while a synchronous counter clocks all n every cycle. For a wide, slow counter that is the dominant term, and the ripple version can be several times cheaper.",
        "OUTPUT QUALITY. This is where they genuinely diverge. A ripple counter passes through real, wrong intermediate states after every edge — 0111 to 1000 goes via 0110, 0100 and 0000 — and any decoder watching will pulse the wrong line. A synchronous counter changes all bits together and never does this.",
        "APPLICATIONS follow directly. Ripple: frequency division, real-time-clock prescalers, slow event counting where the result is read at leisure. Synchronous: program counters, address generators, timers, anything feeding a decoder or a comparator, and anything above a few megahertz.",
        "The one-line rule: if you decode the outputs or care about the timing, use synchronous; if you only want the top bit and you care about power, ripple is not a compromise but the right answer.",
      ],
    }),
  },

  {
    id: "q28",
    number: "28",
    title: "Which counter for a high-speed communication system",
    prompt:
      "Which type of counter would you recommend for a high-speed communication system? Justify your answer.",
    category: "theory",
    tags: ["counter", "recommendation"],
    solve: () => ({
      diagrams: [],
      answer:
        "A synchronous counter — and for widths beyond about 8 bits, a synchronous counter with carry-lookahead or a pipelined/segmented carry.",
      steps: [
        "Recommendation: SYNCHRONOUS. Three of a communication system's requirements make it the only viable option.",
        "First, the clock rate. Serialisers, framers and timing recovery run at the line rate, so the counter must settle within one bit period. A ripple counter's n·t_pd delay does not fit and gets worse with every bit of width.",
        "Second, the outputs are always decoded. A bit counter drives frame boundaries, a byte counter drives a multiplexer, a symbol counter drives a decoder. Transient wrong states in a ripple counter would produce spurious frame markers — corrupting data that was received perfectly.",
        "Third, jitter. A ripple counter's outputs are skewed from the clock by a delay that varies with voltage and temperature, which shows up directly as timing jitter. In a system whose eye diagram is the specification, that is unacceptable.",
        "For widths beyond about 8 bits the carry AND chain becomes the critical path, so use CARRY-LOOKAHEAD, or segment the counter: a fast synchronous low block whose terminal count enables a slower high block. Both keep the synchronous discipline while shortening the chain.",
        "Two refinements worth adding to an answer. A GRAY-CODE counter changes exactly one bit per step, which means no decoding glitches at all and safe sampling across clock domains — which is why every asynchronous FIFO uses Gray-coded pointers, and a FIFO is in every communication system. And a LINEAR-FEEDBACK SHIFT REGISTER counts through 2ⁿ−1 states with a single XOR gate and no carry chain at all, so it is the fastest counter available when the ORDER of the states does not matter — which is exactly the case for scramblers, PRBS test patterns and CRC generators.",
        "So: synchronous binary as the default, Gray code where the output crosses a clock domain or is decoded combinationally, and LFSR where you need a very fast cycle rather than a numeric count.",
      ],
    }),
  },

  // --- calculations ---------------------------------------------------------
  {
    id: "q31",
    number: "31",
    title: "16K×32 — words, bits and addresses",
    prompt:
      "A memory has a capacity of 16K×32. How many words does it store? How many bits per word? How many different addresses does it require?",
    category: "memory",
    tags: ["memory", "calculation"],
    params: [
      { key: "words", label: "Words", kind: "int", min: 2, max: 16777216, initial: 16 * K },
      { key: "bits", label: "Bits per word", kind: "int", min: 1, max: 128, initial: 32 },
    ],
    solve: (v) => {
      const size = memorySizing(num(v, "words", 16 * K), num(v, "bits", 32));
      return {
        diagrams: [],
        answer: `${size.words.toLocaleString("en-US")} words × ${size.bits} bits, ${size.addressLines} address lines.`,
        tables: [
          {
            title: "Result",
            columns: ["quantity", "value"],
            rows: [
              ["Words stored", size.words.toLocaleString("en-US")],
              ["Bits per word", String(size.bits)],
              ["Distinct addresses", size.words.toLocaleString("en-US")],
              ["Address lines", String(size.addressLines)],
              ["Total capacity", `${size.totalBits.toLocaleString("en-US")} bits = ${size.totalBytes.toLocaleString("en-US")} bytes`],
            ],
          },
        ],
        steps: [
          ...describeSizing(size),
          "The two numbers in “16K×32” are independent: the first is how many words (the depth, which sets the address lines) and the second is how wide each word is (which sets the data pins). Multiplying them gives capacity in bits, and nothing else.",
          "Note that K here is 1024, not 1000. 16K = 16 × 1024 = 16,384, which is 2¹⁴ — which is why the address line count comes out a whole number.",
        ],
      };
    },
  },

  {
    id: "q32",
    number: "32",
    title: "16K×12 — address, data-in and data-out counts",
    prompt:
      "How many address inputs, data inputs and data outputs are required for a 16K×12 memory?",
    category: "memory",
    tags: ["memory", "calculation"],
    params: [
      { key: "words", label: "Words", kind: "int", min: 2, max: 16777216, initial: 16 * K },
      { key: "bits", label: "Bits per word", kind: "int", min: 1, max: 128, initial: 12 },
    ],
    solve: (v) => {
      const size = memorySizing(num(v, "words", 16 * K), num(v, "bits", 12));
      return {
        diagrams: [],
        answer: `${size.addressLines} address inputs, ${size.dataInputs} data inputs, ${size.dataOutputs} data outputs.`,
        tables: [
          {
            title: "Pin count",
            columns: ["pins", "how many", "why"],
            rows: [
              ["Address inputs", String(size.addressLines), `2^${size.addressLines} = ${size.words.toLocaleString("en-US")} words`],
              ["Data inputs", String(size.dataInputs), "one per bit of the word"],
              ["Data outputs", String(size.dataOutputs), "one per bit of the word"],
              ["Control", "≥ 2", "chip select and write enable, at minimum"],
            ],
          },
        ],
        steps: [
          ...describeSizing(size),
          "Address pins come from the DEPTH and data pins from the WIDTH. They are computed from different numbers and confusing them is the whole trap in this question.",
          `A real ${size.bits}-bit part would very likely share one bidirectional data bus of ${size.bits} pins rather than have ${size.dataInputs} in and ${size.dataOutputs} out separately — saving ${size.bits} pins, which on a DIP is decisive. The question asks for the logical counts; a datasheet would show ${size.bits} I/O pins plus an output-enable.`,
        ],
      };
    },
  },

  {
    id: "q33",
    number: "33",
    title: "256K bytes from 32K×8 chips",
    prompt:
      "How many 32K×8 RAM chips are needed for 256K bytes? How many address lines must be used, and how many of them go to all chips? How many must be decoded for chip select, and what size decoder?",
    category: "memory",
    tags: ["memory", "expansion", "decoder", "calculation"],
    params: [
      { key: "tw", label: "Target words", kind: "int", min: 2, max: 16777216, initial: 256 * K },
      { key: "tb", label: "Target bits per word", kind: "int", min: 1, max: 64, initial: 8 },
      { key: "cw", label: "Chip words", kind: "int", min: 2, max: 16777216, initial: 32 * K },
      { key: "cb", label: "Chip bits per word", kind: "int", min: 1, max: 64, initial: 8 },
    ],
    solve: (v) => {
      const plan = planExpansion(
        num(v, "tw", 256 * K),
        num(v, "tb", 8),
        num(v, "cw", 32 * K),
        num(v, "cb", 8),
      );
      return {
        diagrams: [],
        answer: `${plan.chips} chips, ${plan.target.addressLines} address lines, ${plan.sharedAddressLines} shared, ${plan.decodedAddressLines} decoded by ${article(plan.decoder?.inputs ?? 0)} ${plan.decoder?.inputs ?? 0}-to-${plan.decoder?.outputs ?? 0} decoder.`,
        tables: [
          {
            title: "Answers, part by part",
            columns: ["part", "answer"],
            rows: [
              ["(a) chips needed", String(plan.chips)],
              ["(b) total address lines", String(plan.target.addressLines)],
              ["(b) lines to every chip", String(plan.sharedAddressLines)],
              ["(c) lines to decode", String(plan.decodedAddressLines)],
              [
                "(c) decoder size",
                plan.decoder ? `${plan.decoder.inputs}-to-${plan.decoder.outputs}` : "none needed",
              ],
            ],
          },
          {
            title: "Address map",
            columns: ["bank", "chip select", "address range"],
            rows: Array.from({ length: plan.deep }, (_, b) => [
              String(b),
              `Y${b}`,
              `${(b * plan.chip.words).toLocaleString("en-US")} – ${((b + 1) * plan.chip.words - 1).toLocaleString("en-US")}`,
            ]),
          },
        ],
        steps: [
          ...describePlan(plan),
          `The chips are ${plan.chip.bits} bits wide and the target word is ${plan.target.bits} bits, so no widening is needed — every chip is a complete word and the ${plan.deep} chips are ${plan.deep} banks stacked in the address space.`,
          `Each chip has ${plan.sharedAddressLines} address pins, so A${plan.sharedAddressLines - 1}..A0 go to all ${plan.chips} of them in parallel. The remaining ${plan.decodedAddressLines} high lines cannot go to the chips — the chips have no pins for them — so they must select WHICH chip responds.`,
          "That is the whole idea of the decoder: the high address bits are decoded into one-hot chip selects, so exactly one chip drives the data bus for any given address. Two chips selected at once is a bus conflict.",
          "Check the arithmetic the other way round: total capacity divided by chip capacity must equal the chip count, and 2^(total address lines) must equal the total word count. If either does not come out whole, one of the numbers is wrong.",
        ],
      };
    },
  },

  {
    id: "q36",
    number: "36",
    title: "Programmable logic versus fixed-function",
    prompt:
      "Analyse the advantages of programmable logic over fixed-function digital circuits.",
    category: "theory",
    tags: ["FPGA", "PLD", "design"],
    solve: () => ({
      diagrams: [],
      steps: [
        "TIME TO MARKET, and it is the dominant one. A fixed-function ASIC takes months and millions of dollars per mask set. An FPGA bitstream is compiled in minutes and costs nothing to change. For anything that is not shipping in enormous volume, that difference decides the choice on its own.",
        "CHANGEABILITY AFTER SHIPPING. A protocol changes, a standard is revised, a bug is found in the field — a programmable device is reconfigured with a firmware update. Fixed logic is replaced with a screwdriver. This is why base stations, test equipment and defence systems are full of FPGAs.",
        "PART-COUNT REDUCTION. One CPLD replaces a board full of 74xx packages, which removes solder joints, board area and interconnect — and interconnect is where reliability problems and propagation delays actually live.",
        "PROTOTYPING AND VERIFICATION. An ASIC design is emulated on FPGAs before tape-out, because a bug found in silicon costs another mask set. The programmable part is the safety net for the fixed one.",
        "RECONFIGURATION AT RUN TIME. Some FPGAs reload part of the fabric while the rest keeps running, so one device can be a video codec now and a cryptographic engine in a millisecond. Fixed logic cannot do this at all.",
        "INVENTORY AND OBSOLESCENCE. One part number covers many products, and a discontinued custom chip is a redesign while a discontinued FPGA is usually a recompile.",
        "The costs, stated honestly, because an analysis that only lists advantages is not an analysis: an FPGA is typically 10–40× larger in area, 3–10× slower, and an order of magnitude more power-hungry than the same function in an ASIC — you are paying for all the routing switches and configuration cells that make it programmable. Unit cost is far higher, so beyond some volume the ASIC's fixed cost amortises and wins. And the bitstream is loaded from external memory at power-up, which is both a boot-time delay and a security surface.",
        "The decision rule in practice: volume and power favour fixed logic; time, flexibility and risk favour programmable. Structured ASICs and eFPGA blocks exist precisely to sit between the two.",
      ],
    }),
  },

  {
    id: "q37",
    number: "37",
    title: "CRC versus Hamming code",
    prompt:
      "Compare CRC and Hamming code. Under what conditions is CRC preferred, and when is Hamming code more suitable?",
    category: "theory",
    tags: ["error detection", "CRC", "Hamming"],
    solve: () => ({
      diagrams: [],
      tables: [
        {
          title: "CRC versus Hamming",
          columns: ["", "CRC", "Hamming (SEC-DED)"],
          rows: [
            ["Purpose", "DETECT errors", "CORRECT errors"],
            ["Response to an error", "Discard and retransmit", "Fix it in place"],
            ["Strength", "Any burst up to the CRC width; all odd-weight errors", "1 bit corrected, 2 detected"],
            ["Overhead", "Fixed (16/32 bits per frame, however long)", "Grows with word: ~8 bits per 64"],
            ["Latency", "Whole frame before the check completes", "Per word, in the memory path"],
            ["Cost", "One shift register and XORs", "Syndrome decoder plus corrector"],
            ["Used in", "Ethernet, USB, storage sectors, ZIP", "ECC DRAM, caches, spacecraft memory"],
          ],
        },
      ],
      steps: [
        "They answer different questions. A CRC tells you THAT the data is wrong. A Hamming code tells you WHICH BIT is wrong. Which you want depends entirely on whether you can ask for the data again.",
        "CRC is preferred when RETRANSMISSION IS AVAILABLE AND CHEAP — a network link, a bus, a file transfer. Detection is enough because the fix is to ask again. CRC is also far stronger per bit of overhead: a 32-bit CRC catches every burst error up to 32 bits and all odd-weight errors, on a frame of any length, for a flat 32 bits. Hamming would need hundreds of check bits to protect the same frame and would still only correct one error.",
        "CRC also suits BURSTY channels. Real physical errors come in runs — a scratch on a disc, a noise transient on a wire — and CRC is designed for exactly that, while Hamming's single-bit correction is defeated by a two-bit burst.",
        "Hamming is preferred where RETRANSMISSION IS IMPOSSIBLE OR TOO EXPENSIVE. DRAM cannot re-fetch a bit that decayed; a probe at Jupiter cannot ask for the packet again with a two-hour round trip; a cache line must be delivered in a fixed number of cycles. In all three, an uncorrectable error is a crash, so correction has to happen locally and immediately.",
        "Hamming also suits LOW-RATE, RANDOM, INDEPENDENT errors — a cosmic ray flipping one DRAM cell — which is precisely the distribution SEC-DED is designed for. Its per-word latency is short and constant, whereas a CRC has to see the whole frame.",
        "In practice, layered systems use both: a memory subsystem with Hamming ECC internally, sending frames over a link protected by CRC. They are complementary rather than competing, and for the strongest channels the modern answer is neither — Reed–Solomon or LDPC, which correct bursts as well as single bits.",
      ],
    }),
  },

  {
    id: "q38",
    number: "38",
    title: "Why CRC beats a parity check",
    prompt: "Why is CRC preferred over a simple parity check?",
    category: "theory",
    tags: ["CRC", "parity", "error detection"],
    solve: () => ({
      diagrams: [],
      steps: [
        "A parity bit detects an ODD number of errors and nothing else. Two bit flips cancel — the parity is unchanged and the corruption is invisible. So parity's detection probability against random multi-bit errors is only about 50%, which is barely better than a coin toss.",
        "Real errors are BURSTS, not isolated flips: a scratch on a disc surface, a noise transient on a cable, a dropout on a radio link all corrupt several adjacent bits at once. Roughly half of all bursts contain an even number of flipped bits, and parity misses every one of them. It fails precisely on the errors that actually occur.",
        "A CRC treats the message as a polynomial over GF(2) and transmits the remainder after dividing by a chosen generator polynomial. That structure gives guarantees, not probabilities: with an r-bit CRC and a properly chosen generator, EVERY burst of length ≤ r is detected, every single- and double-bit error is detected, and all odd-weight errors are detected if the generator has (x+1) as a factor.",
        "For bursts longer than r, the probability of missing one is about 2^−r — for CRC-32 that is one in four billion, against parity's one in two.",
        "The cost difference is negligible, which is what settles it. Parity is one XOR tree; a CRC is an r-bit shift register with a few XORs in the feedback path, computed one bit per clock as the data streams past. On a serial link it is essentially free, and it adds a fixed 32 bits to a frame of any length — so on a 1500-byte Ethernet frame the overhead is under 0.3%.",
        "Where parity survives is where its weakness does not matter and its speed does: a single memory word read in one cycle, where errors are assumed to be single-bit and the check must complete in the same cycle as the read. Even there, ECC (Hamming) has largely replaced it.",
      ],
    }),
  },

  {
    id: "q39",
    number: "39",
    title: "When a parity checker says “fine” but is not",
    prompt:
      "Under what conditions can a parity checker indicate that data is correct even though transmission errors occurred? Justify your answer.",
    category: "theory",
    tags: ["parity", "error detection", "limits"],
    solve: () => ({
      diagrams: [],
      answer:
        "Whenever an EVEN number of bits is corrupted — the flips cancel and the parity is unchanged.",
      steps: [
        "Parity is the XOR of all the bits. Flipping one bit flips the XOR; flipping two flips it twice, which is to say not at all. So ANY even number of errors is completely invisible to a parity check.",
        "Concretely: send 1011001 with even parity (four 1s, parity bit 0). If bits 1 and 3 both flip, the received word has a different value but still an even number of 1s, and the checker passes it as correct.",
        "This is not a rare corner case. Burst errors — the kind that actually happen — corrupt runs of adjacent bits, and about half of all bursts contain an even number of flips. Parity misses every one of those.",
        "There is a second, sneakier case: the PARITY BIT ITSELF plus one data bit both being corrupted. Two errors again, so again undetected — and the parity bit is just as exposed on the wire as anything else.",
        "And a third: an error in a bit that the parity does not cover. If a stuck driver corrupts the framing or the checker computes parity over the wrong window, the arithmetic is correct and the conclusion is still wrong.",
        "The justification for using it anyway is a probability argument. On a channel where errors are rare, independent and single-bit, the chance of two flips in one word is roughly (bit error rate)², which can be negligible. Parity is a bet that the channel behaves that way — and on a bursty channel that bet loses.",
        "So the correct statement of what parity provides: it detects any ODD number of errors, guarantees nothing about even numbers, and is therefore an error-detection method whose failure probability against multi-bit errors is about one half. Any application that cannot tolerate that needs a CRC (to detect) or a Hamming/ECC code (to correct).",
      ],
    }),
  },
];
