/*
* Copyright (c) 2007, Ashley Berlin
* All rights reserved.
*
* Redistribution and use in source and binary forms, with or without
* modification, are permitted provided that the following conditions are met:
*     * Redistributions of source code must retain the above copyright
*       notice, this list of conditions and the following disclaimer.
*     * Redistributions in binary form must reproduce the above copyright
*       notice, this list of conditions and the following disclaimer in the
*       documentation and/or other materials provided with the distribution.
*     * Neither the name of the <organization> nor the
*       names of its contributors may be used to endorse or promote products
*       derived from this software without specific prior written permission.
*
* THIS SOFTWARE IS PROVIDED BY THE AUTHOR ``AS IS'' AND ANY
* EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
* WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
* DISCLAIMED. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY
* DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
* (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
* LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
* ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
* (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
* SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/

Template = function Template(config) {
  for (var [param,value] in config) {
    this[param] = value;
  }
};

Template.Constants = {
  CHOMP_NONE: 0,
  CHOMP_ALL: 1,
  CHOMP_COLLAPSE: 2,
  CHOMP_GREEDY: 3,
};

Template.Exception = function(code, message) {
  this.code = code;
  this.message = message;
}
Template.Exception.prototype = Error.prototype;
Template.Exception.prototype.name = "Template.Exception";

// Just a place for constants
Template.Stash = {
  'PRIVATE': /^[._]/
}

Template.VMethods = {
  SCALAR: {},
  HASH: {},
  LIST: {}
}

Template.prototype = {
  constructor: Template,

  process: function Template$prototype$process(input, params) {
    
    // Reset.
    this.parserOutput = [];

    var parser = new Template.Parser(this);
    var ctx = new Template.Context;

    parser.parse(input);
    this.parserTokens = [].concat(parser._tokenBuffer);
    var chunks = parser.chunks();
    
    this.parserOutput = [].concat(chunks);

    if (this.DBG_OUTPUT_CHUNKS)
      warn('# Chunks: ' + chunks.toSource());

    var ti = new Template.Interpreter(chunks);

    this.interpreterOutput = ti.output;

    if (this.DBG_OUTPUT_FUNC)
      warn(ti.output);

    var func = eval(ti.output);

    if (!params.global)
      params.global = {};

    var Stash = function () { };
    Stash.prototype = params;
    Stash.global = params.global;

    var stash = new Stash();

    return func(ctx, stash);
  }

};


Template.Context = function () { 
  this.out_arr = [];
  this.global = {};
};

Template.Context.prototype = {
  
  write: function(str) { this.out_arr.push(str); },

  get_output: function() { return this.out_arr.join("") },

  nullObj: { toString: function() { return ''; } },

  _dot_op: function Template$Context$_dot_op(stash, name, args, lvalue) {

    var vmeth, initStash;
    if (stash === undefined || name === undefined)
      return;

    if (Template.Stash['PRIVATE'] && Template.Stash.exec(name))
      return;

    if (!args)
      args = [];

    initStash = stash;

    if (stash instanceof Array) {
      vmeth = Template.VMethods.LIST_OPS[item];

      if (vmeth) {
        stash = vmeth.call(stash, args);
      } else if (name.match(/-?\d+$/)) {
        stash = stash[name];
        if (stash instanceof Function)
          stash = stash.apply(stash, args);
      }
    }

    else if (stash[name] instanceof Function) {

      stash = stash[name].apply(this, args);
    } else if (name in stash) {
      stash = stash[name];
    } else if (stash[name] instanceof Array) {

    }
    
    // Try virtual methods
    else {
    }

  },

  dot_op : function Template$Context$dot_op(stash, segments, args) {
    var s = stash;

    if (!args) args = { };

    // We are assigning, so create dict objects as needed...
    if ('assign' in args) {
      var last_seg = segments.pop();
      if (Template.Stash.PRIVATE && last_seg.match(/^_/))
        return;

      for each (var segment in segments) {
        if (Template.Stash.PRIVATE && segment.match(/^_/))
          return;

        if (s[segment] === undefined) {
          s[segment] = {};
        }
        s = s[segment];
      }

      var ret = s[last_seg];
      if (!args['default'] || !ret)
        s[last_seg] = args.assign;

      return ret;
    }

    for each (var segment in segments) {
      if (Template.Stash.PRIVATE && /^_/.exec(segment))
        return this.nullObj;
      s = s[segment];
      if (s === undefined || s == null)
        return ;//this.nullObj;
      if (s instanceof Function) {
        if (!args.args)
          args.args = [];
        s = s.apply(this, args.args);
      }
    }
    
    return s === undefined ? this.nullObj : s;
  },

  /**
   * For each wrapper that promotes var to an array
   */
  forEach: function(a, func) {
    if (a === undefined || a === this.nullObj)
      return;
    if (a instanceof Array == false) {
      a = [a];
    }

    for (var i =0; i < a.length; i++) {
      func(a[i], i, i == a.length);
    }

  }
};

Template.Parser = function (config) {
  this.end_tag   = this.default_end_tag;
  this.start_tag = this.default_start_tag;
  this._tokenWatermark = 0;
  this._tokenBuffer    = [];

  if (!config)
    config = {};

  this.config = config;

/*
  // Spidermonkey Only
  this.__defineGetter__('token', function() {
    if (this._tokenBuffer.length > this._tokenWatermark) {
      return this._tokenBuffer[this._tokenWatermark];
    }
    return {type: "NUL"};

    if (this.tokenizer.eof)
      return {type:"NUL"};

    var token = this.tokenizer.next();
    if (token === undefined)
      this.parseError('Unexpected EoF!');
    this._tokenBuffer.push(token);
    if (token.type == 'PARSE_ERROR')
      this.parseError('Invalid token!');
    return token;
  }); 
*/

  if (config.DEBUG) {
    var self = this;
    // DEBUG logging of calls!
    this._tracedFunctions.split(/\s+/).forEach(function(name) {
      var func = self.__proto__[name];
      self[name] = function Template$Parser$prototype$logCall() {
        try {
          if (name == 'consumeToken') {
            self._logCall(name + '(' + this.token.literal + ')');
          } else if (name == 'assertToken') {
            self._logCall(name + '(' + arguments[0].toSource() + ')');
          } else {
            self._logCall(name);
          }
          var ret = func.apply(self, arguments);
          self._exitCall(name);
          return ret;
        } catch (e) {
          self._exitCall(name, 1);
          throw e;
        }
      };
      self[name].origFunc = func;
    });

    this._callIndent = "";
  }
};

Template.Parser.prototype = {

  _logCall: function(name) {
    /*if (confirm(name) == false)
      throw new Error('cancalled at user request');*/
    warn('* ' + this._callIndent + name);
    this._callIndent += '  ';
  },
  _exitCall: function(name, errorHappened) {
    this._callIndent = this._callIndent.substr(0, this._callIndent.length - 2);
    warn('* ' + this._callIndent + (errorHappened ? 'excepted in ' : 'end ' ) + name);
  },

  // These must be 'regexp-escaped'
  default_start_tag: '\\[%',
  default_end_tag: '%\\]',


  _getToken: function Template$Parser$prototype$prototype$_getToken() {
    if (this._tokenBuffer.length > this._tokenWatermark) {
      return this._tokenBuffer[this._tokenWatermark];
    }
    return {type: "NUL"};

  },

  consumeToken: function Template$Parser$prototype$consumeToken() {
    if (this._tokenWatermark >= this._tokenBuffer.length)
      this.parseError(new Error("Tried to consume token when none were in the buffer!"));

    var ret = this.token;

    this._tokenWatermark++;
    this.token = this._getToken();
    return ret;
  },

  unconsumeToken: function() {
    if (this._tokenWatermark < 1)
      this.parseError(new Error("Tried to unconsume token when the buffer was already at start-of-block!"));
    
    this._tokenWatermark--;
    this.token = this._getToken();
  },

  parseError: function Template$parseError(msg) {
    // TODO: Sort out line number
    var substr = this.origInput.substr(this.token.position, 10).replace(/\n/g, '\\n');
    if (this.token.position + 10 < this.origInput.length)
      substr += '...';
    throw new Error(msg + " at '" + substr + "' " + this.token.toSource());
  },

  log: function(str) {
    if (print) {
      print(str);
    } else {
      if (!this._log)
        this._log = [];
      this._log.push(str);
    }
  },

  assertToken: function assertToken(token, msg) {
    if (typeof token == "string") {
      if (this.token.type != token) {
        this.parseError(msg ? msg : token + ' expected');
      }
    }
    else if (token.type != this.token.type) {
      this.parseError(msg ? msg : token.type + ' expected');
    }
    else if (token.literal && token.literal != this.token.literal) {
      this.parseError(msg ? msg : "'" + token.type + "' expected"); 
    }
    return this.consumeToken();
  },

  assertRule: function Template$Parser$prototype$assertRule(ruleFunc, msg) {
    var ret = ruleFunc.apply(this);

    if (ruleFunc.origFunc) {
      // DEBUG call logging enabled
      ruleFunc = ruleFunc.origFunc;
    }

    if (ret === undefined) {
      if (msg === undefined) {
        // No message passed, search prototype for function name
        for (var [name, func] in this.__proto__) {
          if (func === ruleFunc) {
            msg = name + ' expected';
            break;
          }
        }
      }
      if (!msg)
        msg = ruleFunc.name || ruleFunc.toSource();

      this.parseError(msg);
    }
    return ret;
  },

  /* this cant be a regexp object, since we need to anchor it to different places... */
  chompFlags: "[-=~+]",

  /* Chomp chars to integer values */
  chompValues : { '+': 0, '-': 1, '=': 2, '~': 3 },

  /* 
   * Examine str and split into a list of tokens representing the entire string
   * (including blocks and chunks of text)
   */
  parse: function Template$Parser$prototype$parse(str) {
    // First work out where the start_tag is
    var self = this;

    // ^ doesn't anchor to beging of string only in multi-line mode, it also anchors to start of line
    // This is not what we want, so use .|\n and no /m flag
    var re = new RegExp('^((?:.|\\n)*?)(?:(' + this.start_tag + ')((?:.|\\n)*?)(' + this.end_tag + '))');
    this.origInput = str;

    var pos=0;
    var post = str;

    var match,pre,dir;

    this._tokenBuffer = [];

    while (1) {
      var postchomp = this.postchomp;
      var left = post.replace(re, function(entire, pre, start,dir,end) {

        if (dir) {
          if(dir[0] == '#') {
            // Comment out entire directive bar any end chomp flag
            dir = dir.match(new RegExp( self.chompFlags + '$' ) ) || '';
          } else {
            var chomp = self.prechomp;
            dir = dir.replace(new RegExp('^(' + self.chompFlags + ')'), 
                function(entire, flag) {
                    chomp = self.chompValues[flag];
                    return '';
                }
            );


            /* all = 1, collapse = 2, greedy = 3, none = 0 */
            if (chomp && pre) {
              if (comp == Template.Constants.CHOMP_ALL) {
                pre.replace(/(?:\n|^)[^\S\n]*/, '');
              }
              else
                throw new Error('unhandled chomp flag ' + chomp);
            }
           
            postchomp = self.postchmop;
            dir = dir.replace(new RegExp('(' + self.chompFlags + ')\s*$'), 
                function(entire, flag) {
                    postchomp = self.chompValues[flag];
                    return '';
                }
            );

          }
        }
  
        if (pre.length) {
          //self._tokenBuffer.push({type: 'TEXT', literal: pre, position: pos});
          self._tokenBuffer = self._tokenBuffer.concat(self.interpolate_text(pre, pos));
          
          pos += pre.length;
        }

        pos += start.length;
    
        // Append tokens from this directive to buffer 
        self._tokenBuffer = self._tokenBuffer.concat(self.tokenise(dir, pos));

        pos += dir.length;
        self._tokenBuffer.push({type: ';', position: pos, automatic: 1})

        // move pos past end tag
        pos += end.length;

        return "";
      });


      /* all = 1, collapse = 2, greedy = 3, none = 0 */
      if (postchomp) {
        if (postchomp == Template.Constants.CHOMP_ALL) {
          left = left.replace(/^(?:[^\S\n]*\n)/, '');
        }
        else
          throw new Error('unhandled chomp flag ' + chomp);
      }
            

      if (post.length == left.length)
        break;
      post = left;
    }

    // done with this now
    self = undefined;

    if (post.length) {
      // Anything after the last directive
      this._tokenBuffer = this._tokenBuffer.concat(this.interpolate_text(post, pos));
    }

    this.token = this._getToken();

  },

  // This monster would be so much nicer if JS had the /x flag for regexps
  // Taken from Template::Parser
  tokenise_regexp: /(#[^\n]*)|(["'])((?:\\\\|\\\2|.|\n)*?)\2|(-?\d+(?:\.\d+)?)|(\/?\w+(?:(?:\/|::?)\w*)+|\/\w+)|(\w+)|([(){}\[\]:;,\/\\]|\->|[+\-*]|\$\{?|=>|[=!<>]?=|[!<>]|&&?|\|\|?|\.\.?|\S+)/mg,

  tokenise: function Template$Parser$prototype$tokenise(text, pos) {

    // if you use the /foobar/ constructor, you get a SINGLETON OBJECT - GRRRR
    var re = new RegExp(this.tokenise_regexp.source, 'mg');

    var type, match, token;
    var tokens = [];

    var initPos = pos;

    while (match = re.exec(text) ) {

      pos = initPos + re.lastIndex - match[0].length;
      // Comment in $1
      if (match[1])
        continue;

      // Quoted pharse in $3 (and quote char in $2)
      if (token = match[3]) {
        if (match[2] == '"') {
          if (token.match("[\$\\\\]") ) {
            type = 'QUOTED';
            /* unescape " and \ but leave \$ escaped so that 
             * interpolate_text doesn't incorrectly treat it
             * as a variable reference
             */
            token = token.replace(/\\([^\$nrt])/g, "$1");
            token = token.replace(/\\([nrt])/g, function(str) { return eval('"' + str + '"'); });
           
            tokens.push({type: '"', literal: '"', position: pos});
            pos++;
            var segments = this.interpolate_text(token, pos);

            tokens = tokens.concat(segments);

            pos += match[2].length;
            tokens.push({type: '"', literal: '"', position: pos});
            pos++;
            
            continue;
          }
          else {
            type = 'LITERAL';
            //TODO token =~ s['][\\']g;
            token = "'" + token + "'";
          }
        }
        else {
          type = 'LITERAL';
          token = "'" + token + "'";
        }
      } 
      else if (match[2]) {
        // Empty string
        type = 'LITERAL';
        token = "''";
      }

      // number
      else if ( (token = match[4]) !== undefined) {
        type ='NUMBER';
      }
      else if ( (token = match[5]) !== undefined) {
        type = 'FILENAME';
      }
      else if ( (token = match[6]) !== undefined) {
        // TODO: anycase support
        var uctoken = this.config.ANYCASE ? token.toUpperCase() : token;

        type = this.LEXTABLE[uctoken];
        if (type !== undefined) {
          token = uctoken;
        }
        else {
          type = 'IDENT';
        }
      }
      
      else if ( (token = match[7]) !== undefined) {
        // TODO: anycase support
        var uctoken = token;

        if (this.LEXTABLE[uctoken] === undefined) {
          type = 'UNQUOTED';
        }
        else {
          type = this.LEXTABLE[uctoken];
        }
      }
      else {
        throw new Error('Something went wrong in the tokeniser, and it matched nothing');
      }

      tokens.push({type: type, literal: token, position: pos });
    }

    return tokens;
  },

  /*
   * Examines text looking for any variable references embedded like $this or
   * like ${ this }.
   * 
   */

  interpolate_text: function Template$Parser$prototype$interpolate_text(text, pos) {
    var re = /((?:\\.|[^\$]){1,3000})|(\$(?:(?:\{([^\}]*)\})|([\w\.]+)))/g;
    
    var match, pre, v, dir;
    var tokens = [];
    while (match = re.exec(text)) {
      pre = match[1];
      dir = match[2];
      if (match[3])
        v = match[3];
      else
        v = match[4];

      if (pre && pre.length) {
        pos += pre.length;
        pre = pre.replace(/\\\$/, "$");
        tokens.push({type: 'TEXT', literal: pre, position: pos})
      }

      // $var reference
      if (v) {
        tokens = tokens.concat( this.tokenise(v, pos) );
        pos += v.length;
        tokens.push({type: ';', literal: ';', position: pos});
      }
      else if (dir) {
        throw new Error('interpolate dir');
        tokens.push({type: 'TEXT', literal: dir, position: pos});
      }
    }
    return tokens;
  },

  LEXTABLE: {
    'FOREACH' : 'FOR',
    'BREAK'   : 'LAST',
    '&&'      : 'AND',
    '||'      : 'OR',
    '!'       : 'NOT',
    '|'      : 'FILTER',
    '.'       : 'DOT',
    '_'       : 'CAT',
    '..'      : 'TO',
//    ':'       : 'MACRO',
    '='       : 'ASSIGN',
    '=>'      : 'ASSIGN',
//    '->'      : 'ARROW',
    ','       : 'COMMA',
    '\\'      : 'REF',
    'and'     : 'AND',  // explicitly specified so that qw( and or
    'or'      : 'OR',   // not ) can always be used in lower case, 
    'not'     : 'NOT',  // regardless of ANYCASE flag
    'mod'     : 'MOD',
    'div'     : 'DIV',

    // Reserved words
    GET: 'GET',
    CALL: 'CALL',
    SET: 'SET',
    DEFAULT: 'DEFAULT',
    INSERT: 'INSERT',
    INCLUDE: 'INCLUDE',
    PROCESS: 'PROCESS',
    WRAPPER: 'WRAPPER',
    BLOCK: 'BLOCK',
    END: 'END',
    USE: 'USE',
    PLUGIN: 'PLUGIN',
    FILTER: 'FILTER',
    MACRO: 'MACRO',
    PERL: 'PERL',
    RAWPERL: 'RAWPERL',
    TO: 'TO',
    STEP: 'STEP',
    AND: 'AND',
    OR: 'OR',
    NOT: 'NOT',
    DIV: 'DIV',
    MOD: 'MOD',
    IF: 'IF',
    UNLESS: 'UNLESS',
    ELSE: 'ELSE',
    ELSIF: 'ELSIF',
    FOR: 'FOR',
    NEXT: 'NEXT',
    WHILE: 'WHILE',
    SWITCH: 'SWITCH',
    CASE: 'CASE',
    META: 'META',
    IN: 'IN',
    TRY: 'TRY',
    THROW: 'THROW',
    CATCH: 'CATCH',
    FINAL: 'FINAL',
    LAST: 'LAST',
    RETURN: 'RETURN',
    STOP: 'STOP',
    CLEAR: 'CLEAR',
    VIEW: 'VIEW',
    DEBUG: 'DEBUG',

    // cmp ops
    '!=': 'CMPOP',
    '==': 'CMPOP',
    '<' : 'CMPOP',
    '>' : 'CMPOP',
    '>=': 'CMPOP',
    '<=': 'CMPOP',

    // other bin ops
    '-': 'BINOP',
    '*': 'BINOP',
    '%': 'BINOP',

    // other tokens
    '(':'(',
    ')':')',
    '[':'[',
    ']':']',
    '{':'{',
    '}':'}',
    '${':'${',
    '$':'$',
    '+':'+',
    '/':'/',
    ';':';',
    ':':':',
    '?':'?'
  },


  // grammar rules
  expr: function Template$Parser$prototype$expr() {
    
    if (this.token.type == 'NOT') { 
      // NOT expr
      this.consumeToken();
      return { type: 'NOT', child: this.expr() };
    }

    var term = this.term();
    if (term === undefined)
      return; 
    return this.expr_tail(term);
  },

  expr_tail: function Template$Parser$prototype$expr_tail(term) {
    switch (this.token.type) {
      case '(':
        // '(' assign | expr ')'
        this.consumeToken();
        switch (this.token.type) {
          case 'IDENT':
          case '${':
          case '$':
          case 'LIERAL':
            break;
          default:
            var expr = this.assertRule(this.expr);
            this.assertToken(')')
            return expr;
        }

        // Could be and expr, or could be a assing
        var sterm = this.sterm();
        var ret;
        if (this.token.type == 'ASSIGN') {
          // assign
          this.consumeToken;
          ret = { type: 'ASSIGN', lhs: sterm, rhs: this.assertRule(this.expr) };
        } else {
          // expr
          ret = this.expr_tail(sterm);
        }
        this.assertToken(')');
        return ret;
      
      case '?':
        // expr ? expr : expr
        this.consumeToken();
        var ret = { type: 'TERNARY', condition: term };
        ret.true = this.assertRule(this.expr);
        this.assertToken(':');
        ret.false = this.assertRule(this.expr);
        return ret;

      case 'BINOP':
        return { type: this.consumeToken().literal, lhs: term, rhs: this.assertRule(this.expr) };

      // binary ops
      case '+':
      case '/':
      case 'DIV':
      case 'MOD':
      case 'CAT':
      case 'AND':
      case 'OR':
        return { type: this.consumeToken().type, lhs: term, rhs: this.assertRule(this.expr) };
    }
    // end switch

    return term;
  },

  term: function Template$Parser$prototype$term() {
    // todo: do this properly
    var term = this.lterm();
    if (term) {
      return term;
    }
    
    return this.sterm();
  },
  
  sterm: function Template$Parser$prototype$sterm() {
    switch (this.token.type) {
      case 'LITERAL':
      case 'NUMBER':
        return this.consumeToken();
      case 'REF':
        this.consumeToken();
        var ident = this.assertRule(this.ident);
        return { type: 'REF', ident: ident };
      case '"':
        this.consumeToken();
        var quoted = this.quoted();
        this.assertToken('"');
        return quoted;
      default:
        // might be an ident;
        return this.ident();
    }
  },

  quoted: function Template$Parser$prototype$quoted() {
    var segs = [];
    var loop = true;
    while (loop) {
      switch (this.token.type) {
        case ';':
          this.consumeToken();
          break;
        case 'TEXT':
          segs.push(this.consumeToken());
          break;
        default:
          var ident = this.ident();
          if (ident === undefined)
            loop = false;
          else
            segs.push(ident);
          break;
      }
    }

    if (segs.length)
      return {type: 'QUOTED', segments: segs };
  },

  ident: function Template$Parser$prototype$ident() {
    // DOT separeted list of nodes, followed by an optional DOT number

    var segments = [this.node()];
    if (segments[0] === undefined)
      return undefined;

    while (this.token.type == 'DOT') {
      this.consumeToken();
      
      if (this.token.type == 'NUMBER') {
        segments.push(this.consumeToken());
        break;
      }
      segments.push(this.assertRule(this.node));
    }

    if (segments.length == 1)
      return segments[0];

    return {type: 'ident', segments: segments };
  },

  node: function Template$Parser$prototype$node() {
    var item = this.item();

    if (item === undefined)
      return;

    if (this.token.type == '(') {
      this.consumeToken();
      // args
      var ret = {type: 'function_call', function: item };
      ret.args = this.assertRule(this.args);
      this.assertToken(')');
      return ret;
    } else {
      return item;
    }
  },

  args: function Tempalte$Parser$prototype$args() {
    // named params are stored in ret[0]
    var ret = [ [] ];

    while (1) {
      var ident;
     
      // due to the way ident is written, it will return an ident or item rules
      // so just handle the LITERAL case of param here
      if (this.token.type == 'LITERAL')
        ident = this.consumeToken();
      else 
        ident = this.ident();

      if (ident !== undefined) {
        // an expr could be an ident or a LITERAL, so make sure we have an `=' afterwards
        if (this.token.type != 'ASSIGN') {
          ret.push(ident);
        }
        else {
          // we have a named param
          this.assertToken('ASSIGN');
          ret[0].push(ident);
          ret[0].push(this.assertRule(this.expr));
        }
      } else {
        // else we have a position param
        var expr = this.expr();

        if (expr === undefined)
          break;

        ret.push(expr);
      }

      // Gah - comma is optional
      if (this.token.type == 'COMMA')
        this.consumeToken();
    }

    return ret;
  },

  item: function Template$Parser$prototype$item() {
    var ret;
    switch (this.token.type) {
      case 'IDENT':
        return this.consumeToken();
      case '${':
        this.consumeToken();
        ret = { type: 'interpret', term: this.assertRule(this.sterm) };
        this.consumeToken('}');
        return ret;
      case '$':
        this.consumeToken();
        ret = { type: 'interpret', term: this.assertToken('IDENT') };
        return ret;
      default:
        return;
    }

  },

  lterm: function Template$Parser$prototype$lterm() {
    if (this.token.type == '[') {
      // list, range or empty
      this.consumeToken();

      if (this.token.type == ']') {
        // empty list
        this.consumeToken();
        return {type: 'array', items: [] };
      }
      // range starts with an sterm, list with a term
      var term = this.sterm();

      // could be a range - see if next char is TO '..'
      if (term !== undefined) {
        if (this.token.type == 'TO') {
          this.consumeToken();
          var ret = { type: 'range', from: term, to: this.assertRule(this.sterm) };
          this.assertToken(']');
          return ret;
        }
        // Not followed by a TO, therefore must be a list - just drop out

      } else {
        // No sterm, must be an lterm then
        term = this.assertRule(this.lterm);
      }

      // If we get here, we know we have a list
      var ret = { type: 'array', items: [term] };
  
      while (this.token.type != ']' && this.token.type != 'NUL') {
        if (this.token.type == 'COMMA') {
          this.consumeToken();
          continue;
        }
        ret.items.push(this.assertRule(this.term));
      }

      this.assertToken(']');
      return ret;

    } else if (this.token.type == '{') {
      // hash

      this.consumeToken();

      // cant store data as a dict since it might need interpreting
      var ret = {type: 'hash', data: this.assertRule(this.params) };

      this.assertToken('}');
      
      return ret;
    }
  },

  params: function Template$Parser$prototype$params() {
    var items = [this.assertRule(this.param)];

    while (this.token.type != 'NUL') {
      if (this.token.type == 'COMMA') {
        this.consumeToken();
        continue;
      }

      var item = this.param();

      if (item === undefined)
        break;
      items.push(item);
    }
 
    return items;
  },

  param: function Template$Parser$prototype$param() {
    var ret = { type: 'assign' };

    if (this.token.type == 'LITERAL') {
      ret.to = this.consumeToken();
    } else {
      ret.to = this.item();
      if (ret.to === undefined)
        return;
    }

    this.assertToken('ASSIGN');

    ret.value = this.assertRule(this.expr);

    return ret;
  },

  /**
   * capture, expr, condition (post-fixed only) and setlist all start with 
   * ambigious things - so this rule embodies this
   */
  complex_statement: function Template$Parser$prototype$complex_statement() {
    
    var expr;

    if (this.token.type == 'LITERAL') {
      // only setlist or expr can start with a LITERAL
      var lit = this.consumeToken();

      // If we have an ASSIGN next, we _must_ be a setlist
      if (this.token.type == 'ASSIGN') {

        this.consumeToken();
        return this.setlist_tail(lit); 

      } else {

        // expr
        expr = this.expr_tail(lit);
      }
    } else {

      var ident = this.ident();

      if (ident === undefined)
        return;

      // At this point, we can be an expr, a setlist or a capture

      if (this.token.type == 'ASSIGN') {
        // A capture or a setlist
        this.consumeToken();

        if (this.token.type == 'BLOCK') {
          // mdir
          throw new Error('mdir');
        }

        //throw new Error('WTF do i do here' + ident.toSource());
        // TODO: Capture;

        
        return this.setlist_tail(ident);
      } else {
        expr = this.expr_tail(ident);
      }
      
    }

    if (expr) {
      return this.postfixed_condition(expr);
    }

  },

  // called with an ident or a LITERAL, and the first ASSIGN already consumed
  setlist_tail: function Template$Parser$prototype$setlist_tail(ident) {

    var as = [{ type: 'ASSIGN', lhs: ident }];
    if (this.token.type == 'LITERAL')
      as[0].rhs = this.consumeToken();
    else
      as[0].rhs = this.assertRule(this.expr);

    while (this.token.type != ';') {
      if (this.token.type == 'NUL')
        break;

      // comma seperators are optional
      if (this.token.type == 'COMMA') {
        this.consumeToken();
        continue;
      }

      var i;
      if (this.token.type == 'LITERAL')
        i = this.consumeToken();
      else
        i = this.assertRule(this.ident);

      this.assertToken('ASSIGN');
      as.push( { type: 'ASSIGN', lhs: i, rhs: this.assertRule(this.expr) } );
    }
    return {type: 'setlist', chunks: as};
  },


  postfixed_condition: function Template$Parser$prototype$postfixed_condition(expr) {
    if (this.token.type == 'IF' || this.token.type =='UNLESS') {
      var ret = {type: this.consumeToken().type, body: expr };
      ret.condition = this.assertRule(this.expr);
      return ret;
    }

    return expr;
  },


  atomexpr: function Template$Parser$prototype$atomexpr() {
    return this.expr();
  },

  atomdir: function Template$Parser$prototype$atomdir() {
    switch (this.token.type) {
      case 'GET':
      case 'CALL':
        return { type: this.consumeToken().type, expr: this.assertRule(this.expr) };

      case 'SET':
        this.consumeToken();
        return this.assertRule(this.setlist);
      case 'DEFAULT':
        return { type: this.consumeToken().type, expr: this.assertRule(this.setlist) };
    }
  },

  loop: function Template$Parser$prototype$loop() {
    if (this.token.type == 'FOR' || this.token.type == 'WHILE') {
      var token = this.consumeToken();
      var ret = {type: token.type, loopvar: this.assertRule(token.type == 'FOR' ? this.loopvar : this.expr), chunks: [] };
      this.assertToken(';');
      while (this.token.type != 'END') {
        if (this.token.type == 'NUL') // EOF
          break;
        ret.chunks.push(this.chunk());
      }
      this.assertToken('END');
      return ret;
    }
  },

  loopvar: function Template$Parser$prototype$loopvar() {
    var ident;
    if (this.token.type == 'IDENT') {
      ident = this.consumeToken();
      if (this.token.type == 'ASSIGN')
        this.consumeToken();
      else 
        this.assertToken('IN');
    }
    var ret = { term: this.assertRule(this.term), args: this.args() };
    if (ident)
      ret.ident = ident;

    return ret;
  },

  // `Top level' gramar rules
  chunks: function Template$Parser$prototype$chunks() {
    var chunks = [];
    while (this.token.type != 'NUL') {
      chunks.push(this.chunk());
    }
    return chunks;
  },

  chunk: function Template$Parser$prototype$chunk() {
    if (this.token.type == 'TEXT') {
      return this.consumeToken();
    } else if (this.token.type == ';') {
      this.consumeToken();
      return;
    } else {
      var ret = this.assertRule(this.statement);
      this.assertToken(';');
      return ret;
    }
  },

  statement: function Template$Parser$prototype$statment() {
    return this.complex_statement() || this.directive() || this.expr();
  },

  directive: function Template$Parser$prototype$directive() {
    return this.atomdir() || this.condition() || this.loop();
  },

  condition: function Template$Parser$prototype$condition() {
    if (this.token.type == 'IF' || this.token.type == 'UNLESS') {
      var ret = {type: this.consumeToken().type };
      ret.condition = this.assertRule(this.expr);
      this.assertToken(';');
      ret.body = [];
      while (['END', 'ELSE', 'ELSEIF'].indexOf(this.token.type) == -1) {
        if (this.token.type == 'NUL') // EOF
          break;
        ret.body.push(this.chunk());
      }

      this.conditionElse(ret);

      // TODO make this error say where the block started
      this.assertToken('END');

      return ret;
    }
  },

  conditionElse: function Template$Parser$prototype$conditionElse(cond) {
    var elseifs = [];
    while (this.token.type == 'ELSIF') {
      this.consumeToken();
      var elseif = { condition: this.assertRule(this.expr) };
      this.assertToken(';');
      elseif.body = [];
      while (['END','ELSE', 'ELSIF'].indexOf(this.token.type) == -1) {
        if (this.token.type == 'NUL') // EOF
          break;
        elseif.body.push(this.chunk());
      }

      elseifs.push(elseif);
    }

    if (elseifs.length) {
      cond.elseifs = elseifs;
    }

    if (this.token.type == 'ELSE') {
      this.consumeToken();
      this.assertToken(';');
      cond['else'] = [];
      while (['END','ELSE', 'ELSIF'].indexOf(this.token.type) == -1) {
        if (this.token.type == 'NUL') // EOF
          break;
        cond['else'].push(this.chunk());
      }
    }

    return cond;
  },

  setlist: function Template$Parser$prototype$setlist() {
    var ident;

    if (this.token.type == 'LITERAL')
      ident = this.consumeToken();
    else
      ident = this.ident();

    if (ident === undefined)
      return

    this.assertToken('ASSIGN');
    return this.setlist_tail(ident);
  },

  _tracedFunctions: "consumeToken node ident sterm term expr expr_tail item lterm params param" +
    " chunks condition conditionElse statement tokenise interpolate_text assign setlist directive loop loopvar"
  
};
/*
 * END OF Template.Parser
 */

/* 
 * Template.Interpreter - walks the AST generated by Template.Parser and 
 * returns function that when executed will produce the template output
 */
Template.Interpreter = function Template$Interpreter(chunks) {

  this.output = this.prelude + this.walk(chunks) + this.postlude;
}

Template.Interpreter.prototype = {
  prelude: <><![CDATA[
function(ctx, stash) {
  var out_arr = [];
  function write(str) { out_arr.push(str); };
  try {
  ]]></>,

  postlude: <><![CDATA[}
  catch (e) {
    if (e instanceof Template.Exception) {
      if (e.code != 'stop') {
        throw e;
      }
    } else {
      throw e;
    }
  }
  return out_arr.join("");
}
  ]]></>,

  walk: function Template$Interpreter$prototype$walk(chunks) {
    var output = '';
    for each (var chunk in chunks) {
      if (chunk === undefined) {
        continue;
      }

      // TODO check for things like GET, SET or CALL
      // Not everything writes directly.
      var write = ['IF', 'FOR', 'CALL', 'setlist', 'DEFAULT'].indexOf(chunk.type) == -1 ? 1 : 0;


      output += '/* ' + chunk.toSource() + ' */\n';
      if (write) {
        output += 'write(';
      }
      output += this.$get_term(chunk);

      if (write) {
        output += ');';
      }
      output += '\n';
    }
    return output;
  },

  $get_term: function Template$Interpreter$prototype$$get_term(term) {
    switch (term.type) {

      case 'TEXT':
        return  uneval(term.literal);
      case 'ident':
        return 'ctx.dot_op(' + this.handle_ident_segments(term.segments) + ')';

      case 'IDENT':
        return "ctx.dot_op(stash, [" + uneval(term.literal) + "])";
      case 'NUMBER':
        return parseFloat(term.literal);
      case 'LITERAL':
        return term.literal;
      case 'IF':
        var condition = this.$get_term(term.condition);
        var body = this.walk(term.body);
        var ret = "if (" + condition+ ") {\n" + body.replace(/^/gm, '  ') + "\n}";

        if (term['else']) {
          ret += ' else {\n' + this.walk(term['else']).replace(/^/gm, '  ') + '\n}';
        }
        return ret;
      case '+':
      case '/':
      case '*':
      case '%':
      case '-':
        return this.math_op(term);
      case 'interpret':
        var out = [];
        out.push(this.$get_term(term.term));
        if (term.literal) {
          out.push(term.literal);
        }
        return 'ctx.dot_op(stash, [ ' + out.join(' + ') + '])';
      case 'GET':
      case 'CALL':
        // GET is default action - return value of the expr
        return this.$get_term(term.expr);

      case 'QUOTED':
        
        var out = [];
        for each (var seg in term.segments) {
          if (seg.type == ';')
            continue;
          out.push(this.$get_term(seg));
        }
        return out.join(' + ');
      case 'function_call':
        // an item followed by some args
        var [stash, segs] = this.handle_ident_segments([term.function]);

        var args = this.handle_function_args(term.args);
      
        return 'ctx.dot_op(' + stash + ', [' + segs + '], { args: ' + args + ' } )';
  
      case 'DEFAULT':
        var defaults = true;
        term = term.expr;
        // Drop thru
      case 'setlist':

        var ret = [];
        for each (var assign in term.chunks) {
          var [stash, segs] = this.handle_ident_segments([assign.lhs]);

          if (assign.rhs.type == 'interpret') {
            ret.push('ctx.dot_op(' + stash + ', ' + segs + ', { '+ (defaults ? 'default:1, ':'') +'assign: ctx.dot_op(stash, [' + this.$get_term(assign.rhs.term) + '] ) } )');
          } else {
            ret.push('ctx.dot_op(' + stash + ', ' + segs + ', { '+ (defaults ? 'default:1, ':'') +'assign: ' + this.$get_term(assign.rhs) + ' } )');
          }
        }
        return ret.join(', ') + ';';
        
      case 'FOR':
        var loopvar = term.loopvar.ident ? this.handle_ident_segments([term.loopvar.ident]) : undefined;
        var loopcond = this.$get_term(term.loopvar.term);

        if (loopvar === undefined) {
        }

        var ret = 'ctx.forEach(' + loopcond + ', function(value, idx, last) {\n  ctx.dot_op(stash, [\'loop\'], { assign: {count: idx+1, index: idx, frst: idx == 0, last: last} } )';

        if (loopvar) {
          ret += '\n  ctx.dot_op(' + loopvar + ', { assign: value } );\n';
        }

        var chunks = this.walk(term.chunks);
        ret += chunks.replace(/^/mg, '  ');

        ret += '\n});';

        return ret;

      case 'array':
       return '[' + term.items.map(this.$get_term).join(', ') + ']';

      case 'hash': 
        var pairs = [ ];

        for each (var pair in term.data) {
          if (pair.to.type != 'IDENT') {
            throw new Error('Cant handle ' + pair.to.type + ' in hash key!');
          }
          pairs.push( pair.to.literal + ': ' + this.$get_term(pair.value) ) ;
        }

        return '{ ' + pairs.join(', ') + ' }';

      case 'OR':
        return '( (' + this.$get_term(term.lhs) + ') || (' + this.$get_term(term.rhs) + ') )';
      case 'AND':
        return '(' + this.$get_term(term.lhs) + ') && (' + this.$get_term(term.rhs) + ')';
      case 'NOT':
        return '!(' + this.$get_term(term.child) + ')';

      default:
        throw new Error('Unhandled ' + term.toSource());
    }
  },

  handle_function_args: function Template$Interpreter$prototype$handle_function_args(args) {
    var named = args.shift();
    var argsOut = [];
    var out = ''
    for each (var arg in args) {
      argsOut.push(this.$get_term(arg));
    }

    if (argsOut.length)
      out += argsOut.join(', ');

    return '[' + out + ']';
  },

  handle_ident_segments: function Template$Interpreter$prototype$handle_ident_segments(segs) {
    var stash = 'stash';
    var var_name = [];
    for each (var seg in segs) {
      if (seg.type == 'IDENT') {
        var_name.push(uneval(seg.literal)); 
      }
      else if (seg.type == 'interpret') {
        if (seg.term.type == 'LITERAL') {
          var_name.push(seg.term.literal);
        } else {
          var_name.push(this.$get_term(seg.term));
        }
        continue;
      }
      else if (seg.type == 'function_call') {
        if (seg.args[0] instanceof Array == false)
          throw new Error('args[0] is not an array!');
        // This is more difficult - since we could have something like
        // [% foo.bar(1,2,3).baz.fish
        // in which case we want output something like:
        // ctx.dot_op(ctx.dot_op(stash, ['foo','bar'],[1,2,3]), ['baz,'fish'])
        var funcName;
        if (seg.function.type == 'IDENT')
          var_name.push(uneval(seg.function.literal));
        else if (seg.function.type == 'interpret') {
          var_name.push(this.$get_term(seg.function));
        }
        else
          throw new Error('Unknown function type name ' + seg.function.type + '\n' + seg.toSource());

        stash = 'ctx.dot_op(' + stash + ', [' + var_name + '], { args: '+this.handle_function_args(seg.args)+' } )';
        var_name = [];
      }
      else if (seg.type == 'LITERAL') {
        var_name.push(seg.literal);
      }
      else if (seg.type == 'ident') {
        // TODO: this is prolly wrong
        return this.handle_ident_segments(seg.segments);
      }
      else
        throw new Error('Unknown segment type in ident clause: ' + seg.type + '\n' + seg.toSource());
    }
    if (var_name.length == 0)
      return stash;
    return [stash, '[' + var_name + ']'];
  },


  math_op: function(expr) {
    var ret = '( ';
    if (expr.lhs.type != 'NUMBER')
      ret += 'parseFloat( ' + this.$get_term(expr.lhs) + ' )';
    else
      ret += this.$get_term(expr.lhs);

    ret += ' ' + expr.type + ' ';

    if (expr.rhs.type != 'NUMBER')
      ret += 'parseInt( ' + this.$get_term(expr.rhs) + ' )';
    else
      ret += this.$get_term(expr.rhs);

    return ret + ' )';
  },


};
/*
 * END OF Template.Interpreter
 */


log = [];
