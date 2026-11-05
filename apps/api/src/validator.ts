// Voice validators. CLAUDE.md is explicit that these run in app code, not the
// LLM (§8.5), before any voice is emitted (§3.2 HARD RULE, §4 post-render check).
// The gpt-4o prompt is the first line of defence; this is the guarantee.

export interface Driver {
  metric: string;
  value: string;
  trend?: string;
}

export interface ValidationResult {
  ok: boolean;
  bannedHits: string[]; // banned phrases found in the voice
  unbackedNumbers: string[]; // numbers in the voice with no matching driver
  // Claims with no number that no driver backs: a measure the record does not
  // have ("HRV"), or a direction said against the driver ("Load direction").
  unbackedClaims: string[];
}

// §4.1 voice-level bans. Targeted so we don't false-positive on legitimate
// interpretation. "coach" is only flagged in self-referential forms (§4.2
// allows third-person "most coaches would…"), which shouldn't appear in a read.
const BANNED_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /\b(your|an?)\s+ai[\s\-–]+(?:\w+\s+)?coach\b|\byour\s+(?:virtual|digital|robot)\s+(?:\w+\s+)?coach\b/i, label: 'ai coach' },
  // "I'm your coach", "I'm a coach", "I am an endurance coach", "SCORA is your coach".
  // The athlete's real coach as the subject stays allowed (Coach tier): "As
  // your coach planned it", "Sarah has been coaching you".
  {
    re: /\b(i'?m|i am)\s+your\s+(?:\w+\s+)?coach\b|\bas\s+your\s+(?:\w+\s+)?coach\b(?!'s|\s+(?:has|had|planned|plans|wrote|writes|set|sets|put|built|scheduled|noted|said|says|sees|saw|designed|moved|added|laid|asked|called|mentioned|marked|expects|expected|intended|wants|wanted)\b)|\b(?:i'?m|i am|scora is)\s+(?:your|an?)\s+(?:\w+\s+)?coach\b|\byour coach here\b|\b(?:i'?m|i am|i'?ve been|i have been|i'?ll be|i will be|i'?ll keep|we'?re|scora is|scora'?s)\s+coaching you\b|(?:^|[.;!?]\s+)coaching you\b/i,
    label: 'coach self-reference',
  },
  // The same claim in other words. The athlete's real coach as the subject stays
  // allowed ("Sarah coaches you", "Your trainer's note").
  {
    re: /\b(?:i'?m|i am|scora is)\s+(?:your|an?)\s+(?:\w+\s+)?trainer\b|\bas\s+your\s+(?:\w+\s+)?trainer\b(?!'s)|\bconsider me your\b|\b(?:i|i'?ll|i will|i can|here to|scora|scora will|let me)\s+coach(?:es)?\s+you\b|(?:^|[.;!?]\s+)coach here\b|\b(?:my|our|scora'?s)\s+coaching\b/i,
    label: 'coach self-reference',
  },
  { re: /\bas an ai\b|\b(?:i'?m|i am) an ai\b/i, label: 'as an ai' },
  { re: /\bi'?m just an ai\b/i, label: 'just an ai' },
  { re: /\byou(?: \w+ly)? should(?:n'?t)?\b/i, label: 'you should' },
  { re: /\byou(?:'ll|'d| will| would| may| might)?(?: \w+ly)? need to\b(?! (?:go|look|scroll) back\b[^.;!?]{0,30}\b(?:to|and not) (?:find|see)\b)/i, label: 'you need to' },
  { re: /\byou(?: \w+ly)? must(?:n'?t)?\b/i, label: 'you must' },
  { re: /\b(go for an?|go do an?|do an easy|do a hard)\b/i, label: 'workout imperative' },
  // "Run a tempo today" is an order; "your last long run a week ago" is history.
  {
    re: /(?<!\b(?:long|easy|tempo|recovery|hard|last|first|next|the|your|this|that|one|every|each|steady|threshold|interval|group|morning|evening|trail|track|race|you|you'?ve|have|has|had|never|did|didn't)\s)\brun an?\b(?!\s+(?:week|day|month|year|while|few|couple|bit|lot|little|touch)\b)/i,
    label: 'workout imperative',
  },
  { re: /(?<!\b(?:long|short|some|more|enough|the|had|has|have|having|need|needs|needed|take|takes|took|taking|give|gives|gave|given|giving|get|gets|got|getting|of|little|less|extra|no|found|made|body|system|legs|you|it) )\btime to (run|go|get|train|rest|back off|ease|recover(?! (?:has|have|was|is|took)\b)|push|hit|take|cut|pull back|hold back|dial|slow|sleep)\b/i, label: 'workout imperative' },
  { re: /\bdoes that sound (?:right|fair|good|ok|okay)\b|\blet me know what you think\b|\b(?:you (?:may|might|could) be right|fair point\b(?! of)|i could be wrong|i may be wrong|i might be wrong)\b/i, label: 'authority surrender' },
  { re: /\b(let me know if that )?resonate/i, label: 'authority surrender' },
  { re: /\bwhat do you think\b|\bdoes (?:that|this) (?:make sense|feel right|track|land|fit|match)\b|\bhow does (?:that|this) (?:sound|feel|land)\b|(?:^|[.;!?]\s+)(?:sounds? good|makes? sense|sounds? right)\?|\byou know your body\b/i, label: 'authority surrender' },
  { re: /\b(?:good|great|nice) catch\b/i, label: 'sycophantic flip' },
  // "You're right where the plan expects" and "at the top of your range" stay
  // allowed: a flip is "you're right" alone, or about what the athlete said.
  { re: /\byou(?:'re| are) right(?:[,.;:!?]|$| about\b(?! (?:at|where|on|in|level|even|the same)\b)| that\b| to\b)/i, label: 'sycophantic flip' },
  {
    re: /(?:^|[.;!?]\s+)(?:good|great|fair|valid|nice) point\b(?! of\b)|\bthat'?s an? (?:good|great|fair|valid) point\b|\byou (?:make|made|raise|have) a (?:\w+ )?point\b|\bfair enough\b|\bpoint taken\b|\bi stand corrected\b|\bmy (?:mistake|bad|error|apologies)\b|\bi apologi[sz]e\b|\bsorry,? (?:i|about|for|that)\b|\bi (?:was|am) wrong\b|\bi'?m wrong\b|\bi got (?:that|it|this) wrong\b|\bi (?:undersold|oversold|overstated|understated|misread|misjudged|misspoke|missed that)\b|\blet me (?:revise|reconsider|rethink|correct|rephrase|walk that back)\b|\bon second thought\b|\bi take that back\b|\bnow that you mention\b|\byou(?:'ve| have)? convinced me\b/i,
    label: 'sycophantic flip',
  },
  { re: /\b(medical|diagnos|prescri[bp])/i, label: 'clinical claim' },
  // Naming a condition, or reading one out of the data (§11). An illness the
  // athlete logged may still be named: "Illness is marked on your plan".
  {
    re: /\b(?:overtraining|overtrained|an(?:a)?emi[ac]\w*|sleep apn(?:o)?ea|insomnia|stress fracture|tendin[io]\w*tis|arrhythmia|a-?fib|symptoms?)\b|\b(?:getting(?!\s+something)|coming down with|fighting(?: off)?|battling)\s+(?:sick\b|ill\b|something\b|an? (?:infection|illness|bug|virus|cold|flu)\b|the flu\b)|\b(?:signs?|indicat\w+|suggest\w*|points? to|means?|consistent with)\b[^.;!?]{0,20}\b(?:illness|injury|infection|sick\w*)\b/i,
    label: 'clinical claim',
  },
  // Advice in other words (CLAUDE.md §1.1, §3.1): "Aim for 45 minutes",
  // "Consider a rest day", "It's a good day to run long", "Make sure to sleep".
  {
    re: /\b(?:(?<!\b(?:the|your|its|\w+'s) )aim for|make sure (?:to|you)|you(?:'ll|'d| will) want to|you (?:ought|have|might want|may want|would want) to(?! (?:go|look|scroll) back\b| zoom out\b| compare\b)|(?<!\b(?:second|third|next) )(?:it'?s |it is )?(?:best|wise|smart) to(?! date\b| read\b)|(?:it'?s |it is )?(?<!\b(?:was|were|been) )a (?:good|great|fine|smart) (?:day|time|morning|week) to|(?<!\b(?!you\b|i\b|we\b)\w+ would )consider (?:an?\b|rest\b|(?!training\b)\w+ing\b)|you (?:might|may|could) (?:go(?! back\b[^.;!?]{0,30}\b(?:to|and not) (?:find|see)\b)|run|ride|swim|try|take|keep|ease|skip|rest|back off|hold|stay|stick))/i,
    label: 'advice',
  },
  // A first-person steer: "I'd keep today easy", "Let's back off". Reading the
  // record stays allowed: "I'd call this settled", "I'd keep this read".
  {
    re: /\b(?:i'?d|i would|we'?d|we would|we should|we could|let'?s)(?: (?:probably|just|really|definitely|still|also|personally))* (?:keep (?:it|today|tomorrow|things|the (?:effort|run|pace|session|tempo)|this (?:one|run|session))|go (?:easy|hard|long|short|out|for)|skip|back off|take (?:it(?! as\b)|the day|today|tomorrow|a(?!(?: \w+)? look)|an)|rest|(?:run|ride|swim)(?! through)|stay (?:easy|off|home|in|light|low|aerobic|under|below)|hold (?:off(?! on (?:calling|reading|naming)\b)|back)|ease|cut|shorten|move(?! on)|save|consider (?:an?\b|rest\b|\w+ing\b)|try|aim|stick(?! with (?:this|that|the) read\b)|pull back|dial|recommend|suggest|advise|encourage)\b|\bif i were you\b|\bi (?:recommend|suggest|advise|encourage|urge)\b|\bmy (?:advice|recommendation|suggestion)\b/i,
    label: 'advice',
  },
  // A verdict on what to do, with no verb to give the order: "Your best bet is
  // rest", "An easy day makes sense", "Today should be easy". The plan's own
  // words and history stay allowed: "The plan calls for tempo", "The plan made
  // the right call", "Sleep should show up in HRV".
  {
    re: /\byour (?:best|safest) (?:bet|option|move|choice|call|play)\b|(?<!\bmade )\b(?:the|a) (?:smart|right|best|wise|safe) (?:move|play|choice|option|call) (?:is|today|here|would|this)\b|\bis the (?:right|best|smart) call\b|\bis the way to go\b|\b(?:easy|easier|rest(?! of\b)|short|shorter|light|lighter|recovery)\b(?! (?:nights?|sleep)\b)[^.;!?,]{0,20}\bmakes? sense\b(?! of\b)|\b(?:today|tomorrow|this morning|this run|this session) (?:should|ought to|needs to|has to|must)(?: \w+ly)? (?:be|stay|remain|feel)\b|\b(?:the run|the session) (?:should|ought to|needs to|has to|must)(?: \w+ly)? (?:stay|remain|be (?:easy|short|shorter|light|lighter|gentle))\b|(?<!\b(?:plan|schedule|calendar|block|template) (?:for )?)\b(?:today|tomorrow|this morning) calls? for (?:rest\b|easy\b|recovery\b|an? (?:easy|rest|recovery|short|shorter|light|lighter|gentle)\b)|\b(?:easy|easier|rest(?! of)|short|shorter|light|lighter|gentle|recovery|min|mins|minutes)\b[^.;!?]{0,25}\bwould (?:be (?:ideal|better|plenty|enough(?! to)|wise|smart|prudent|perfect|best|good)|help(?! explain| account)|pay off)\b|\bwould (?:do you good|serve you)\b|\b(?:wouldn'?t|would not|won'?t|can'?t) hurt\b(?! the (?:average|trend)\b)|(?:^|[.;!?]\s+|,\s+)(?:probably |maybe )?better to\b(?! read\b| look at\b)|\b(?:it'?s|it is|would be) better to\b(?! read\b| look at\b)/i,
    label: 'advice',
  },
  // The same steer through "you": "You'd benefit from", "You're better off",
  // "You can skip", "You don't need to run". "You can see it" stays allowed.
  {
    re: /\byou(?:'d| would)? better\b|\byou(?:'d| would| may| might| could| will|'ll)? benefit from\b|\byou(?:'re| are|'d be| would be| will be|'ll be) better off\b|\byou(?:'d| would) do well to\b|\byou(?:'d| would) be (?:wise|smart)\b|\byou can (?:skip|afford|take it|ease|back off|go easy|cut (?:it|the \w+|today'?s \w+) short|shorten|move (?:it|the \w+|today'?s \w+) to|hold off|rest|keep it)\b|\byou don'?t (?:need|have) to (?:run|push|train|go(?! back\b[^.;!?]{0,30}\b(?:to|and not) (?:find|see)\b)|do|ride|swim|hit|force|race|finish)\b/i,
    label: 'advice',
  },
  // Offered rather than told: "Worth backing off", "How about a shorter run?",
  // "Feel free to skip". "Worth a look" and "worth keeping an eye on" stay allowed.
  {
    re: /\bworth (?:backing|keeping (?:it|today|tomorrow|things|(?:the|this)(?! \w+ in (?:view|mind)\b))|skipping|cutting|shortening|easing|taking(?! note| stock| seriously)|moving|holding(?! on)|dialing|dropping|pulling|resting|saving|trying|swapping)\b|\b(?:why not|how about|what about) (?:an?|some|taking|skipping|keeping|going|easing|resting|rest|just|take|go|run|keep|skip)\b|\bfeel free to\b|\b(?:it'?s|it is) (?:ok|okay|fine|alright|all right) to (?:skip|rest|back|take|cut|go|ease|move|miss|shorten|run|stop)\b|\bno (?:need|shame|harm) (?:to|in)\b(?! read\b| guess\b| look past\b)|(?:^|[.;!?]\s+)(?:maybe|perhaps) an? (?:easy|short|shorter|light|lighter|gentle|recovery)\b(?! (?:night|week|block)\b)/i,
    label: 'advice',
  },
  // Commands only at the start of a clause: "Keep the effort low." is an
  // order; "you were able to hold the pace" and "HR did stay in zone 2" are history.
  {
    re: /(?:^|[.;!?]\s+|,\s+(?:so\s+|then\s+|and\s+)?|\s(?:so|and|then)\s+|[—–]\s*|\s-\s+)(?<!\b(?:tend|tends|tended|able|managed) to\b[^.;!?]{0,40})(?:just\s+|please\s+)?(?:(?:keep|hold) (?:the|your) (?:effort|pace|intensity|heart rate|hr)\b|(?:don'?t|do not) (?:push|go hard|run|race|overdo|do|train|ride|swim|force)|avoid (?:intensity|hard|speed|running|racing|pushing)|stay (?:in|under|below|within) (?:zone|z\s?\d|your))/i,
    label: 'advice',
  },
  // "Most coaches would call this a rest day" (descriptive) stays allowed.
  // "Have a rest day" only as an order at the start of a clause; "you have a
  // rest day scheduled Sunday" describes the plan.
  {
    re: /(?<!\b(?:didn'?t|did not|never|usually|rarely|tend to|tends to) )\b(take|make (?:it|today|tomorrow|this)|treat (?:it|today|tomorrow|this) as) an? (?:\w+ )?rest day\b|(?:^|[.;:!?]\s+|,\s+|[—–]\s*)have an? (?:\w+ )?rest day\b/i,
    label: 'rest-day imperative',
  },
  // A clause that opens on a command verb: "Go easy today.", "Take the day
  // off.", "Run 30 easy minutes.", "— go easy today". Verbs that are also
  // nouns or idioms ("Keep in mind", "Hit rate", "Take last week") count only
  // with a workout object. A colon is not a clause start ("Plan today: run
  // tempo" describes the plan).
  {
    re: new RegExp(
      String.raw`(?:^|[.;!?]\s+|,\s+(?:so\s+|then\s+|and\s+)?|[—–]\s*|\s-\s+|\(\s*|\sso\s+|(?:bottom line|the takeaway|takeaway|my (?:advice|read|take|call|vote)|the (?:call|move|play|verdict)):\s+)(?:(?:just|please|maybe|perhaps|probably|simply)\s+)*` +
      // A split by sport is a list, not an order: "swim 40, ride 260, run 112",
      // "(run 300, ride 112)".
      String.raw`(?<!\b(?:swim|ride|run|bike) \d+(?:\s?[a-z]+)?,\s)(?!(?<=\(\s*)(?:swim|ride|run|bike) \d+(?:\s?[a-z]+)?,\s(?:swim|ride|run|bike) \d)` +
      String.raw`(?:go (?:easy|hard|out|run|for|long|slow|do|ride|on)|back off (?:today|tomorrow|now|a bit|this)|swim (?:easy|hard|long|today|tomorrow|an?|\d+)|do intervals|move (?:it|the|today'?s|your|tomorrow'?s) \w+ to|take (?:it|the day|a(?!(?: \w+)? look)|an|today|tomorrow)|keep (?:it|things|today|the pace|easy)|keep (?:the|your|this|tomorrow|today's)(?: \w+)? (?:easy|short|light|low|gentle|relaxed|aerobic|under|below)|hit (?:the|your|it)|try (?:a|an|the|to|some|\d+)|head (?:out|to(?! head\b))|jog(?! (?:recovery|pace|volume|minutes|time)\b)|ease (?:into|up|off|back|in)|stay (?:easy|off|home|in|light|low|aerobic)|ride (?:easy|hard|today|tomorrow|an?|\d+)|skip (?:the|it|today|tomorrow|your|this)|rest (?:up|now)|rest (?:today|tomorrow)(?!\s+(?:is|was|sits|stays|on|in|falls|comes)\b)|start (?:with(?! sleep| hrv| load| the (?:sleep|hrv|load|numbers?|data))|easy|slow)|do (?:an?|the|some|your)(?! (?:\w+ )?numbers\b)|run (?:an?|the|it|\d+|easy|tempo|hard|long|short|slow|fast|today|tomorrow|for)|ride for|swim for|shoot for|(?<!\d, )target \d+|cap (?:it|the|today|this|your)|limit (?:it|the|today|yourself|this|your)|walk (?:today|tomorrow|it|instead)|(?:hold|pull|dial|scale|throttle) (?:back|it back|things back)|sit (?:this|it|today|tomorrow)(?: \w+)? out|shorten (?:the|it|today'?s|your|this)|cut (?:the|it|today'?s|today|your|this)(?: \w+)? short|swap (?:the|it|today'?s|your)|drop (?:the|it|today'?s|your|this)|give yourself|listen to your body|prioriti[sz]e|focus on (?:recovery|rest|sleep|easy|getting|your)|stick (?:to|with)|get (?:some|more|to bed|to sleep|out|in (?:an?|some)|after it)|go get|add (?:an?|some|\d+)|throw in|be sure to|remember to|push (?:through|harder|it|on))\b(?!\s+(?:is|was|were|sits|stays|held|pace (?:has|have|is|was|held)|of the (?:block|week|month))\b)`,
      'i',
    ),
    label: 'workout imperative',
  },
  // Plan advice in disguise: telling the athlete to recover lost minutes or to
  // trim the plan (CLAUDE.md §1.3; the weekly review states adherence only).
  // Descriptive uses stay allowed: "easy runs make up the bulk", "volume cut
  // back 6%", "sleep fell behind", "next week you start the taper".
  {
    re: /\b((?<!\b(?:not|didn'?t|don'?t|doesn'?t|won'?t|can'?t|cannot) )make up (?:for|those|lost|missed|it|(?:the|that|this) (?:lost|missed|missing|gap|difference|minutes|miles|run|tempo|session|workout|long run|\w+ run))|(?<!\b(?:yet|until \w+) to )catch up(?: on)?|you (?:could |should |might |can )(?:cut|scale) back|you (?:cut|scale) back(?! in (?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*| last (?:week|month|block)\b)|you fell behind(?! on sleep\b)|fall behind|next week,? you (?:could|should|might|can|need|will want|'ll want|add|run|do|try|take|keep|go))\b|(?:^|[.;!?]\s+)(?:cut|scale) back\b/i,
    label: 'plan advice',
  },
  // Doc 06 §4.2 and §4.3: soft prescription and false authority.
  {
    re: /\byou should think about\b|\bconsider whether\b|\bin my experience\b|\bdo this workout\b|\b(?:today'?s|tomorrow'?s) (?:workout|session|run) should be\b|(?:^|[.;!?]\s+)move this to\b/i,
    label: 'advice',
  },
  { re: /\b(smarter|better) than (?:your|a|any|the) (?:human )?coach(?:es)?\b/i, label: 'anti-coach' },
  { re: /\breplac(?:e|es|ed|ing) (?:your|a|the) coach\b/i, label: 'anti-coach' },
  {
    re: /\b(crush(?:ed|es|ing)?|smash(?:ed|ing)?|beast|let'?s go+|(?<!(?:\bnot|n't|\bnever) )keep it up|great (?:job|work)|nice (?:job|work)|amazing|awesome|you(?:'ve| have)? got this(?! (?:far|week|month|block|morning)\b)|nail(?:ed)? it|get after it|let'?s (?:do (?:this|it)|get it)|lfg|kill(?:ing|ed)? it|you'?re on fire|no excuses|no pain,? no gain|you dominat\w+)\b|(?:^|[.;!?]\s+)(?:good job|way to go)\b/i,
    label: 'hype',
  },
];

// Talking the athlete out of their plan (CLAUDE.md §1.3). Checked only when
// the read carries a 'Plan today' driver: the voice may name the session and
// the body's state, never change the session.
const PLAN_DRIVER_METRIC = 'Plan today';
const PLAN_OVERRIDE = /\b((?<!\b(?:was|were|been|got) )skip(s|ping)?\b|(?<!\b(?:was|were|been|got|you|you'?ve|you have) )skipped\b(?! (?:sessions?|workouts?|runs?|rides?|days?)\b)|swap(s|ping|ped)?\b|postpon(e|es|ing|ed)\b|push(es|ed|ing)? (it|(?!(?<=pushed )the (?:pace|effort)\b)the \w+|today'?s \w+) (back|to)\b|(move|moves|moving|moved|shift|shifting) (it|the \w+|today'?s \w+) to\b|(can|could|should) wait\b|hold(ing)? off\b(?! on (?:calling|reading|naming)\b)|sav(e|ing) (it|the \w+) for\b|(?<!\byou )cut(ting)? (it|the \w+) short\b|(?<!\b(?:sleep|runs) (?:has |have |had |was |is )?)shorten(s|ing|ed)?\b|(?<!\byou (?:ran|rode|swam|trained)\b[^.;!?]{0,40})(?!(?<=\d )instead of (?:the )?(?:usual )?\d)instead\b(?! of (?:(?:an? )?(?:dip|drop|fall|slide|rise|climb)|falling|dropping|dipping|sliding|slipping|climbing|rising|settling|holding)\b)|(?<!\b(?:was|were) (?:a )?)(a )?better day for\b|(an )?eas(y|ier) (day|session|run|effort) (would|fits|makes|might)\b|would be better (on|in|as|for)\b|(?<!\b(?:sleep|load|hrv) is (?:the )?)(the )?better fit\b|keep(ing)? (it|the \w+) (short|under|below)\b|(?<!\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|yesterday)'s )lighter (day|session|option)\b|take it easy\b|dial(ing|led)? (it|things|the \w+) back\b|scal(e|ing) (it|the \w+) back\b|(?<!\b(?:average|trend) )(?:(?:work|fit|suit|land)s?|would (?:work|fit|suit|land|go|sit)) better\b|suits? (?:it|the \w+) better\b|(?:isn'?t|is not|(?:may|might) not be) the day for\b|(?:tempo|session|workout|run|intervals?|today'?s \w+) (?:is|looks?(?: like)?|seems?(?: like)?|(?:may|might) be) too much\b|(?:set|put) (?:the plan|it) aside\b|(?:ignore|forget|ditch|scrap|override|disregard) (?:the|your|today'?s) (?:plan|\w+)\b|don'?t follow\b|plan is wrong\b|(?<!\b(?:the|a|an|that|this|hrv|sleep|load) )(?:trade|replace|bump|drop) (?:it|the (?!(?:next |following )?(?:day|night|morning|week|month)\b)\w+|today'?s \w+)\b|is optional\b|(?:could|can|might|may) (?:move|shift|slide) to\b|(?:(?:today|monday|tuesday|wednesday|thursday|friday|saturday|sunday)'s \w+|the (?!average\b|trend\b)\w+) moved to\b|(?:was|were|has been|have been|got) (?:moved|shifted|pushed|bumped) to\b)/i;

// Words that only describe a change the plan engine already made: "the plan
// moved the tempo to Wednesday", "is now an endurance run instead".
const OBSERVED_CHANGE = /^(moved (it|the \w+|today'?s \w+) to|instead|(?:\w+'s \w+|the \w+) moved to|(?:was|were|has been|have been|got) (?:moved|shifted|pushed|bumped) to)$/i;
// Any sign the sentence argues or advises rather than observes. A clause that
// opens on "moved" or "instead" has no subject, so it reads as an instruction.
const ADVICE_CUE = /\b(you (could|should|might|can|may|need)|could|should|consider|try|maybe|perhaps|why not|better|would(?! not have\b)|let'?s|if you|yours)\b|^\s*(move|moved|instead|skip|swap|push|shift|save|cut|shorten|hold|take|keep|go|run|do|make|ease|rest)\b/i;
// An observation says the change happened: "is now", "was moved", "the plan".
const CHANGE_MARKER = /\b(is now|was|were|has been|moved|the plan|plan engine)\b/i;
// Days and sessions a sentence names. Each must come from one recorded change.
const CHANGE_WORDS = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tempo|threshold|intervals?|long|hard|easy|recovery|endurance|steady|moderate|rest)\b/gi;

// True when every plan-override hit in the voice is a plain observation of a
// change the engine made (a 'Plan change' driver), CLAUDE.md §1.3: the clause
// says the change happened, gives no advice, and names only days and sessions
// that one recorded change names. Anything else is treated as an override.
function overrideIsObservation(voice: string, drivers: Driver[]): boolean {
  const changes = drivers.filter((d) => d.metric === 'Plan change').map((d) => d.value.toLowerCase());
  if (changes.length === 0) return false;
  const clauses = voice.split(/(?<=[.?:;])\s+/);
  for (const clause of clauses) {
    const hits = [...clause.matchAll(new RegExp(PLAN_OVERRIDE.source, 'gi'))].map((m) => m[0]);
    if (hits.length === 0) continue;
    if (!hits.every((h) => OBSERVED_CHANGE.test(h)) || ADVICE_CUE.test(clause) || !CHANGE_MARKER.test(clause)) return false;
    // Days and sessions the change itself names: each hit and the word after
    // it ("moved the tempo to Wednesday"), not context like "after a short
    // Monday night".
    const near = [...clause.matchAll(new RegExp(`(?:${PLAN_OVERRIDE.source})(?:\\s+\\S+)?`, 'gi'))].map((m) => m[0]).join(' ');
    // A hit that names nothing itself ("... an endurance run instead") is
    // judged by the whole clause.
    const named0 = near.match(CHANGE_WORDS) ?? clause.match(CHANGE_WORDS) ?? [];
    const words = [...new Set(named0.map((w) => w.toLowerCase().replace(/s$/, '')))];
    if (words.length === 0) return false;
    const named = (c: string) => words.every((w) => new RegExp(`\\b${w}s?\\b`).test(c));
    if (!changes.some(named)) return false;
  }
  return true;
}

// Template mechanics that reached the text: an unfilled {{slot}} (the pattern
// shape goes to the model with its slots in place) or a value that never
// existed. Neither has digits, so the number check cannot see them.
const LEFTOVER = /\{\{|\}\}|\bundefined\b|\bNaN\b|\bInfinity\b|\[object Object\]/;

// What a sentence may name only when a driver for it exists (CLAUDE.md §3.2).
// The number check cannot catch "HRV is climbing" with no HRV in the record. A
// sentence saying the data is absent ("no sleep data yet") is not a claim.
const DRIVER_KINDS: { kind: string; re: RegExp }[] = [
  { kind: 'HRV', re: /\bhrv\b|\bheart rate variability\b/i },
  { kind: 'sleep', re: /\bsle(?:ep|pt)\b/i },
  { kind: 'resting HR', re: /\bresting (?:hr|heart rate)\b|\brhr\b/i },
  { kind: 'Oura', re: /\boura\b/i },
];
const SAYS_ABSENT = /\b(?:no|not|none|without|missing|unavailable|yet|never)\b|n't\b/i;

// A driver's direction said in words beside its name, with no number: "HRV is
// climbing" is not backed by "-8% wk". Only present-tense words that always mean
// a direction, right after the name: "over" and "more" do not, and "Load dropped
// the week before" is history.
const SAID_UP = 'up|higher|rising|climbing|climbs';
const SAID_DOWN = 'down|lower|dropping|falling|dipping|slipping';
const NAMED_TREND: { metric: RegExp; word: string }[] = [
  { metric: /^HRV\b/, word: 'hrv' },
  { metric: /^Load$/, word: 'load' },
  { metric: /^Weekly volume$/, word: '(?:weekly )?volume' },
];
function saidAgainstTrend(voice: string, drivers: Driver[]): string[] {
  const hits: string[] = [];
  for (const d of drivers) {
    const name = NAMED_TREND.find((n) => n.metric.test(d.metric));
    const m = name && `${d.value} ${d.trend ?? ''}`.match(/([+-])\s?(\d+(?:\.\d+)?)\s?%/);
    if (!name || !m || parseFloat(m[2]) === 0) continue;
    const against = m[1] === '+' ? SAID_DOWN : SAID_UP;
    const near = (words: string) => new RegExp(String.raw`\b${name.word}\b(?:\s+(?:is|was|has|have|are|were|been|still|also|just|now|already|keeps?|kept))*\s+(?:${words})\b`, 'i');
    if (near(against).test(voice)) hits.push(`${d.metric} direction`);
  }
  return hits;
}

const EXCLAMATION = /[!¡]/;
// Any pictographic emoji (§3.7 no emoji).
const EMOJI = /\p{Extended_Pictographic}/u;

// Pull number tokens out of text. Times like 15:09 and decimals like 24.9 are
// split the same way on both the driver side and the voice side, so formats
// line up (15:09 -> "15","09"; 24.9 -> "24.9").
function numberTokens(text: string): string[] {
  // "1,540" is one number, not 1 and 540.
  const joined = text.replace(/\b(\d{1,3})((?:,\d{3})+)\b/g, (_m, a: string, b: string) => a + b.replace(/,/g, ''));
  return (joined.match(/\d+(?:\.\d+)?/g) || []).map((n) => String(parseFloat(n)));
}

// A day window as driver names and the voice write it: "7d", "(28d)",
// "7-day", "7 days", "last 7 full days".
const WINDOW_PHRASE = /(?<![\d.:,])(\d+)(?:\s?d\b|[\s-]days?\b|\s+full\s+days?\b)/gi;
// The voice may also say a day window's average in nights ("the 7-night
// average", "7-night baseline"), but never a count of nights ("7 nights in
// a row"), which is a claim and must be backed.
const VOICE_NIGHT_AVERAGE = /(?<![\d.:,])(\d+)[\s-]nights?\s+(?:average|avg|baseline|mean)\b/gi;

// Cyrillic letters drawn the same as Latin ones.
const LOOKALIKE: Record<string, string> = { \u0430: 'a', \u0435: 'e', \u043E: 'o', \u0440: 'p', \u0441: 'c', \u0443: 'y', \u0445: 'x', \u0456: 'i', \u0410: 'A', \u0415: 'E', \u041E: 'O', \u0420: 'P', \u0421: 'C', \u0422: 'T', \u0425: 'X' };

// What the checks read: the model's typography folded to plain text, so a
// curly apostrophe ("I’m your coach"), a doubled or non-breaking space
// ("you  should"), fullwidth or Arabic-Indic digits ("９９", "٩٩"), "½", a
// zero-width or soft hyphen ("you\u200Bshould"), an accent and a look-alike
// letter match like their plain forms. The voice itself is never changed.
export function normalizeForCheck(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[\p{M}\p{Cf}]/gu, '')
    .normalize('NFKC')
    .replace(/[\u0430\u0435\u043E\u0440\u0441\u0443\u0445\u0456\u0410\u0415\u041E\u0420\u0421\u0422\u0425]/g, (c) => LOOKALIKE[c])
    .replace(/[\u2010-\u2012]/g, '-')
    .replace(/[\u2018\u2019\u201B\u02BC\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201F\u2033]/g, '"')
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/\u2044/g, '/')
    .replace(/\s+/g, ' ');
}

// What the phrase bans read, on top of that: markup and line layout gone, so a
// clause still starts where the athlete sees one ("**Go easy.**", a bullet, a
// line break with no period), and "A.I." reads as "AI". Numbers are read from
// normalizeForCheck, unchanged by this.
function textForBans(rawVoice: string): string {
  return normalizeForCheck(rawVoice.replace(/\s+/g, (m) => (m.includes('\n') ? '. ' : ' ')))
    .replace(/[*_`"]/g, '')
    .replace(/\ba\.i\.(?=[\s,;:]|$)/gi, 'AI')
    .replace(/\.{2,}\s*/g, '. ')
    .replace(/(^|[.;!?]\s+)[-•‣]\s+/g, '$1')
    .trim();
}

// Numbers written as words are numbers too: "fifty-two", "seven hours".
// Counts like "two nights" or "the second run" stay allowed; a word number
// is checked when it is a compound of tens or carries a unit.
const ONES: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const WORD_UNITS = String.raw`(?:hours?|hrs?|minutes?|mins?|seconds?|secs?|ms|milliseconds?|bpm|beats|miles?|mi|km|kilomet(?:er|re)s?|percent|per cent|%)`;
function wordNumbers(text: string): { word: string; value: string }[] {
  const out: { word: string; value: string }[] = [];
  const tens = new RegExp(String.raw`\b(${Object.keys(TENS).join('|')})(?:[\s-](${Object.keys(ONES).slice(0, 9).join('|')}))?\b`, 'gi');
  for (const m of text.matchAll(tens)) out.push({ word: m[0], value: String(TENS[m[1].toLowerCase()] + (m[2] ? ONES[m[2].toLowerCase()] : 0)) });
  const withUnit = new RegExp(String.raw`\b(${Object.keys(ONES).filter((w) => w !== 'one').join('|')})\s+${WORD_UNITS}\b`, 'gi');
  for (const m of text.matchAll(withUnit)) out.push({ word: m[0], value: String(ONES[m[1].toLowerCase()]) });
  return out;
}

const UP = /\b(above|up|higher|over|rose|risen|climb(?:ed|ing|s)?|rising|more|gain(?:ed)?)\b/i;
const DOWN = /\b(below|(?<!\b(?:settl\w*|slow\w*|wind\w*|calm\w*) )down|under|lower|dropped|fell|fallen|falling|less|dip(?:ped)?|slipped)\b/i;

// Unit families as the voice and drivers write them.
const UNIT: [RegExp, string][] = [
  [/^(?:ms|milliseconds?)$/i, 'ms'], [/^bpm$/i, 'bpm'], [/^(?:min|mins|minutes?)$/i, 'min'],
  [/^(?:mi|miles?)$/i, 'mi'], [/^(?:k|km|kilomet(?:er|re)s?)$/i, 'km'], [/^(?:%|percent)$/i, '%'], [/^(?:h|hrs?|hours?)$/i, 'h'],
];
// [number, unit family or '', matched text] for each number in the text.
function unitPairs(text: string): [string, string, string][] {
  const out: [string, string, string][] = [];
  // "7:12" is 7 h 12 min (or 7 min 12 s for a pace): both parts may be said with units.
  for (const m of text.matchAll(/(?<![\d:])(\d{1,2}):([0-5]\d)(?![\d:])/g)) {
    out.push([String(parseFloat(m[1])), 'h', m[0]], [String(parseFloat(m[1])), 'min', m[0]], [String(parseFloat(m[2])), 'min', m[0]], [String(parseFloat(m[2])), '', m[0]]);
  }
  for (const m of text.matchAll(/(?<![\d.:])(\d+(?:\.\d+)?)(?![\d:])\s?(%|[a-z]+)?/gi)) {
    const raw = m[2] ?? '';
    const unit = raw ? UNIT.find(([re]) => re.test(raw))?.[1] ?? '' : '';
    out.push([String(parseFloat(m[1])), unit, m[0].trim()]);
  }
  return out;
}

// Check a generated voice string against the drivers it was allowed to cite.
export function validateVoice(rawVoice: string, drivers: Driver[]): ValidationResult {
  const voice = normalizeForCheck(rawVoice);
  const banText = textForBans(rawVoice);
  const bannedHits: string[] = [];
  for (const { re, label } of BANNED_PATTERNS) {
    if (re.test(banText)) bannedHits.push(label);
  }
  if (drivers.some((d) => d.metric === PLAN_DRIVER_METRIC) && PLAN_OVERRIDE.test(banText) && !overrideIsObservation(banText, drivers)) {
    bannedHits.push('plan override');
  }
  if (EXCLAMATION.test(voice)) bannedHits.push('exclamation point');
  if (EMOJI.test(voice)) bannedHits.push('emoji');
  if (LEFTOVER.test(voice)) bannedHits.push('unfilled template');
  const driverText = drivers.map((d) => `${d.metric} ${d.value} ${d.trend ?? ''}`).join(' ');
  const unbackedClaims: string[] = [];
  for (const { kind, re } of DRIVER_KINDS) {
    if (re.test(driverText)) continue;
    if (voice.split(/(?<=[.!?;])\s+/).some((s) => re.test(s) && !SAYS_ABSENT.test(s))) unbackedClaims.push(kind);
  }
  unbackedClaims.push(...saidAgainstTrend(voice, drivers));

  // Driver-existence: every number in the voice must appear in some driver
  // value or trend. A driver NAME backs no number ("Load (7d)" does not back
  // "7 hours"); it only lets the voice quote that name's window as a window
  // ("over 7 days", "the 7-day average"), which is removed before the check.
  const allowed = new Set<string>();
  for (const d of drivers) {
    for (const tok of numberTokens(`${d.value} ${d.trend ?? ''}`)) {
      allowed.add(tok);
    }
  }
  const windows = new Set(drivers.flatMap((d) => [...d.metric.matchAll(WINDOW_PHRASE)].map((m) => String(parseFloat(m[1])))));
  const dropWindow = (w: string, n: string) => (windows.has(String(parseFloat(n))) ? ' ' : w);
  const numberText = windows.size ? voice.replace(WINDOW_PHRASE, dropWindow).replace(VOICE_NIGHT_AVERAGE, dropWindow) : voice;
  const unbackedNumbers = [...new Set(numberTokens(numberText))].filter((n) => !allowed.has(n));
  for (const w of wordNumbers(voice)) if (!allowed.has(w.value)) unbackedNumbers.push(w.word);
  // A driver number cited with a unit must carry a unit the driver has:
  // "HRV 52 bpm" is not backed by "52ms". A number some driver states with no
  // unit (a score, a count) may take any.
  const driverUnits = new Map<string, Set<string>>();
  for (const d of drivers) {
    for (const [num, unit] of unitPairs(`${d.value} ${d.trend ?? ''}`)) {
      driverUnits.set(num, (driverUnits.get(num) ?? new Set()).add(unit));
    }
  }
  for (const [num, unit, text] of unitPairs(voice)) {
    const units = driverUnits.get(num);
    if (unit && units && !units.has(unit) && !units.has('')) unbackedNumbers.push(text);
  }
  // A signed driver cited by its number must move the way the voice says:
  // "HRV down 8%" is not backed by "+8% wk".
  const sentences = voice.split(/(?<=[.!?;])\s+/);
  for (const d of drivers) {
    const m = `${d.value} ${d.trend ?? ''}`.match(/([+-])\s?(\d+(?:\.\d+)?)\s?%/);
    if (!m) continue;
    // Two signed drivers of the same size: the number alone cannot say which.
    const same = drivers.filter((o) => new RegExp(String.raw`[+-]\s?${m[2].replace('.', '\\.')}\s?%`).test(`${o.value} ${o.trend ?? ''}`));
    if (same.length > 1) continue;
    const pct = new RegExp(String.raw`(?<![\d.])${m[2].replace('.', '\\.')}(?![\d])\s?%`);
    for (const sentence of sentences.filter((x) => pct.test(x))) {
      if (m[1] === '+' && DOWN.test(sentence) && !UP.test(sentence)) bannedHits.push(`wrong direction for ${d.metric}`);
      if (m[1] === '-' && UP.test(sentence) && !DOWN.test(sentence)) bannedHits.push(`wrong direction for ${d.metric}`);
    }
  }

  return {
    ok: bannedHits.length === 0 && unbackedNumbers.length === 0 && unbackedClaims.length === 0,
    bannedHits,
    unbackedNumbers,
    unbackedClaims,
  };
}

// Deterministic, guaranteed-valid voice built only from driver values. Used as
// the last resort when the LLM can't produce a clean read. Numeric-first,
// non-prescriptive, no banned phrases by construction.
export function buildFallbackVoice(drivers: Driver[], leadIn = 'Where things sit'): string {
  if (drivers.length === 0) return `${leadIn}: not enough data to read yet.`;
  // A value can be a sentence of its own (a stored plan change): one period.
  const parts = drivers.map(
    (d) => `${d.metric} ${d.value}${d.trend ? ` (${d.trend})` : ''}`.replace(/[.\s]+$/, '')
  );
  return `${leadIn}: ${parts.join('. ')}.`;
}
