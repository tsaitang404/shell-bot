#!/usr/bin/env node
// 启动Bot，处理权限和对话上下文
// 解释命令并且委托执行
// 每运行一个指令实例，开启新的进程。
// 必须设置 ID

var path = require("path");
var fs = require("fs");
var botgram = require("botgram");
var escapeHtml = require("escape-html");
var utils = require("./lib/utils");
var Command = require("./lib/command").Command;
var Editor = require("./lib/editor").Editor;

var CONFIG_FILE = path.join(__dirname, "config.json");
try {
    var config = require(CONFIG_FILE);
} catch (e) {
    console.error("不能载入配置文件, 启动向导\n");
    require("./lib/wizard").configWizard({ configFile: CONFIG_FILE });
    return;
}

var bot = botgram(config.authToken, { agent: utils.createAgent() });
var owner = config.owner;
var tokens = {};
var granted = {};
var contexts = {};
var defaultCwd = process.env.HOME || process.cwd();

var fileUploads = {};

bot.on("updateError", function (err) {
  console.error("更新时出错：", err);
});

bot.on("synced", function () {
  console.log("就绪了！");
});


function rootHook(msg, reply, next) {
  if (msg.queued) return;

  var id = msg.chat.id;
  var allowed = id === owner || granted[id];

  // If this message contains a token, check it
  if (!allowed && msg.command === "start" && Object.hasOwnProperty.call(tokens, msg.args())) {
    var token = tokens[msg.args()];
    delete tokens[msg.args()];
    granted[id] = true;
    allowed = true;

    // Notify owner
    // FIXME: reply to token message
    var contents = (msg.user ? "User" : "Chat") + " <em>" + escapeHtml(msg.chat.name) + "</em>";
    if (msg.chat.username) contents += " (@" + escapeHtml(msg.chat.username) + ")";
    contents += "你可以开始使用了。要撤销请执行:";
    reply.to(owner).html(contents).command("revoke", id);
  }

  // If chat is not allowed, but user is, use its context
  if (!allowed && (msg.from.id === owner || granted[msg.from.id])) {
    id = msg.from.id;
    allowed = true;
  }

  // Check that the chat is allowed
  if (!allowed) {
    if (msg.command === "start") reply.html("没有被授权使用这个功能。");
    return;
  }

  if (!contexts[id]) contexts[id] = {
    id: id,
    shell: utils.shells[0],
    env: utils.getSanitizedEnv(),
    cwd: defaultCwd,
    size: {columns: 40, rows: 20},
    silent: true,
    interactive: false,
    linkPreviews: false,
  };

  msg.context = contexts[id];
  next();
}
bot.all(rootHook);
bot.edited.all(rootHook);


// Replies
bot.message(function (msg, reply, next) {
  if (msg.reply === undefined || msg.reply.from.id !== this.get("id")) return next();
  if (msg.file)
    return handleDownload(msg, reply);
  if (msg.context.editor)
    return msg.context.editor.handleReply(msg);
  if (!msg.context.command)
    return reply.html("没有在运行的指令。");
  msg.context.command.handleReply(msg);
});

// Edits
bot.edited.message(function (msg, reply, next) {
  if (msg.context.editor)
    return msg.context.editor.handleEdit(msg);
  next();
});

// Convenience command -- behaves as /run or /enter
// depending on whether a command is already running
bot.command("r", function (msg, reply, next) {
  // A little hackish, but it does show the power of
  // Botgram's fallthrough system!
  msg.command = msg.context.command ? "enter" : "run";
  next();
});

// Signal sending
bot.command("cancel", "kill", function (msg, reply, next) {
  var arg = msg.args(1)[0];
  if (!msg.context.command)
    return reply.html("没有在运行的指令。");

  var group = msg.command === "cancel";
  var signal = group ? "SIGINT" : "SIGTERM";
  if (arg) signal = arg.trim().toUpperCase();
  if (signal.substring(0,3) !== "SIG") signal = "SIG" + signal;
  try {
    msg.context.command.sendSignal(signal, group);
  } catch (err) {
    reply.reply(msg).html("不能发送这个信号");
  }
});

// Input sending
bot.command("enter", "type", function (msg, reply, next) {
  var args = msg.args();
  if (!msg.context.command)
    return reply.html("没有在运行的指令。");
  if (msg.command === "type" && !args) args = " ";
  msg.context.command.sendInput(args, msg.command === "type");
});
bot.command("control", function (msg, reply, next) {
  var arg = msg.args(1)[0];
  if (!msg.context.command)
    return reply.html("没有在运行的指令。");
  if (!arg || !/^[a-zA-Z]$/i.test(arg))
    return reply.html("使用 /control &lt;字母&gt; 发送Control+字母到这个进程。");
  var code = arg.toUpperCase().charCodeAt(0) - 0x40;
  msg.context.command.sendInput(String.fromCharCode(code), true);
});
bot.command("meta", function (msg, reply, next) {
  var arg = msg.args(1)[0];
  if (!msg.context.command)
    return reply.html("没有在运行的指令。");
  if (!arg)
    return msg.context.command.toggleMeta();
  msg.context.command.toggleMeta(true);
  msg.context.command.sendInput(arg, true);
});
bot.command("end", function (msg, reply, next) {
  if (!msg.context.command)
    return reply.html("没有在运行的指令。");
  msg.context.command.sendEof();
});

// Redraw
bot.command("redraw", function (msg, reply, next) {
  if (!msg.context.command)
    return reply.html("没有在运行的指令。");
  msg.context.command.redraw();
});

// Command start
bot.command("run", function (msg, reply, next) {
  var args = msg.args();
  if (!args)
    return reply.html("使用 /run &lt;指令&gt; 去执行点什么...");

  if (msg.context.command) {
    var command = msg.context.command;
    return reply.text("一个指令已经运行。");
  }

  if (msg.editor) msg.editor.detach();
  msg.editor = null;

  console.log("对话 «%s»: 运行指令 «%s»", msg.chat.name, args);
  msg.context.command = new Command(reply, msg.context, args);
  msg.context.command.on("exit", function() {
    msg.context.command = null;
  });
});

// Editor start
bot.command("file", function (msg, reply, next) {
  var args = msg.args();
  if (!args)
    return reply.html("使用 /file &lt;文件&gt; 可以查看或编辑文本文件。");

  if (msg.context.command) {
    var command = msg.context.command;
    return reply.reply(command.initialMessage.id || msg).text("一个指令正在运行中...");
  }

  if (msg.editor) msg.editor.detach();
  msg.editor = null;

  try {
    var file = path.resolve(msg.context.cwd, args);
    msg.context.editor = new Editor(reply, file);
  } catch (e) {
    reply.html("不能打开文件: %s", e.message);
  }
});

// Keypad
bot.command("keypad", function (msg, reply, next) {
  if (!msg.context.command)
    return reply.html("没有在运行的指令。");
  try {
    msg.context.command.toggleKeypad();
  } catch (e) {
    reply.html("无法切换键盘。");
  }
});

// File upload / download
bot.command("upload", function (msg, reply, next) {
  var args = msg.args();
  if (!args)
    return reply.html("使用 /upload &lt;文件&gt; 我会把他发给你。");

  var file = path.resolve(msg.context.cwd, args);
  try {
    var stream = fs.createReadStream(file);
  } catch (e) {
    return reply.html("无法打开文件: %s", e.message);
  }

  // Catch errors but do nothing, they'll be propagated to the handler below
  stream.on("error", function (e) {});

  reply.action("upload_document").document(stream).then(function (e, msg) {
    if (e)
      return reply.html("无法发送文件: %s", e.message);
    fileUploads[msg.id] = file;
  });
});
function handleDownload(msg, reply) {
  if (Object.hasOwnProperty.call(fileUploads, msg.reply.id))
    var file = fileUploads[msg.reply.id];
  else if (msg.context.lastDirMessageId == msg.reply.id)
    var file = path.join(msg.context.cwd, msg.filename || utils.constructFilename(msg));
  else
    return;

  try {
    var stream = fs.createWriteStream(file);
  } catch (e) {
    return reply.html("不能写入文件: %s", e.message);
  }
  bot.fileStream(msg.file, function (err, ostream) {
    if (err) throw err;
    reply.action("typing");
    ostream.pipe(stream);
    ostream.on("end", function () {
      reply.html("文件写入: %s", file);
    });
  });
}

// Status
bot.command("status", function (msg, reply, next) {
  var content = "", context = msg.context;

  // Running command
  if (context.editor) content += "Editing file: " + escapeHtml(context.editor.file) + "\n\n";
  else if (!context.command) content += "没有指令在运行。\n\n";
  else content += "指令运行在 PID "+context.command.pty.pid+".\n\n";

  // Chat settings
  content += "Shell: " + escapeHtml(context.shell) + "\n";
  content += "终端尺寸: " + context.size.columns + "x" + context.size.rows + "\n";
  content += "工作目录: " + escapeHtml(context.cwd) + "\n";
  content += "静悄悄: " + (context.silent ? "yes" : "no") + "\n";
  content += "shell是否可交互: " + (context.interactive ? "yes" : "no") + "\n";
  content += "链接可预览: " + (context.linkPreviews ? "yes" : "no") + "\n";
  var uid = process.getuid(), gid = process.getgid();
  if (uid !== gid) uid = uid + "/" + gid;
  content += "UID/GID: " + uid + "\n";

  // Granted chats (msg.chat.id is intentional)
  if (msg.chat.id === owner) {
    var grantedIds = Object.keys(granted);
    if (grantedIds.length) {
      content += "\n授权对话:\n";
      content += grantedIds.map(function (id) { return id.toString(); }).join("\n");
    } else {
      content += "\n 不允许闲聊。 使用 /grant 或 /token 允许别人对话。";
    }
  }

  if (context.command) reply.reply(context.command.initialMessage.id);
  reply.html(content);
});

// Settings: Shell
bot.command("shell", function (msg, reply, next) {
  var arg = msg.args(1)[0];
  if (arg) {
    if (msg.context.command) {
      var command = msg.context.command;
      return reply.reply(command.initialMessage.id || msg).html("有指令运行时不能改变shell");
    }
    try {
      var shell = utils.resolveShell(arg);
      msg.context.shell = shell;
      reply.html("Shell 已改变。");
    } catch (err) {
      reply.html("不能改变 shell。");
    }
  } else {
    var shell = msg.context.shell;
    var otherShells = utils.shells.slice(0);
    var idx = otherShells.indexOf(shell);
    if (idx !== -1) otherShells.splice(idx, 1);

    var content = "当前 shell: " + escapeHtml(shell);
    if (otherShells.length)
      content += "\n\n其他 shells:\n" + otherShells.map(escapeHtml).join("\n");
    reply.html(content);
  }
});

// Settings: Working dir
bot.command("cd", function (msg, reply, next) {
  var arg = msg.args(1)[0];
  if (arg) {
    if (msg.context.command) {
      var command = msg.context.command;
      return reply.reply(command.initialMessage.id || msg).html("有指令运行时不能改变工作目录。");
    }
    var newdir = path.resolve(msg.context.cwd, arg);
    try {
      fs.readdirSync(newdir);
      msg.context.cwd = newdir;
    } catch (err) {
      return reply.html("%s", err);
    }
  }

  reply.html("在: %s", msg.context.cwd).then().then(function (m) {
    msg.context.lastDirMessageId = m.id;
  });
});

// Settings: Environment
bot.command("env", function (msg, reply, next) {
  var env = msg.context.env, key = msg.args();
  if (!key)
    return reply.reply(msg).html("使用 %s 查看或者修改变量的值", "/env <name>", "/env <name>=<value>");

  var idx = key.indexOf("=");
  if (idx === -1) idx = key.indexOf(" ");

  if (idx !== -1) {
    if (msg.context.command) {
      var command = msg.context.command;
      return reply.reply(command.initialMessage.id || msg).html("有指令运行时不能改变环境。");
    }

    var value = key.substring(idx + 1);
    key = key.substring(0, idx).trim().replace(/\s+/g, " ");
    if (value.length) env[key] = value;
    else delete env[key];
  }

  reply.reply(msg).text(printKey(key));

  function printKey(k) {
    if (Object.hasOwnProperty.call(env, k))
      return k + "=" + JSON.stringify(env[k]);
    return k + " unset";
  }
});

// Settings: Size
bot.command("resize", function (msg, reply, next) {
  var arg = msg.args(1)[0] || "";
  var match = /(\d+)\s*((\sby\s)|x|\s|,|;)\s*(\d+)/i.exec(arg.trim());
  if (match) var columns = parseInt(match[1]), rows = parseInt(match[4]);
  if (!columns || !rows)
    return reply.text("使用 /resize <列> <行> 改变终端大小。");

  msg.context.size = { columns: columns, rows: rows };
  if (msg.context.command) msg.context.command.resize(msg.context.size);
  reply.reply(msg).html("终端大小已更新。");
});

// Settings: Silent
bot.command("setsilent", function (msg, reply, next) {
  var arg = utils.resolveBoolean(msg.args());
  if (arg === null)
    return reply.html("使用 /setsilent [yes|no] 控制指令的输出是否静音。");

  msg.context.silent = arg;
  if (msg.context.command) msg.context.command.setSilent(arg);
  reply.html("输出将" + (arg ? "" : "不") + "会静音发送。");
});

// Settings: Interactive
bot.command("setinteractive", function (msg, reply, next) {
  var arg = utils.resolveBoolean(msg.args());
  if (arg === null)
    return reply.html("使用 /setinteractive [yes|no] 控制shell是否是可交互的。 启用会加载.bashrc文件中的别名，但可能会导致某些 shell（例如fish）中出现错误。");

  if (msg.context.command) {
    var command = msg.context.command;
    return reply.reply(command.initialMessage.id || msg).html("指令运行时无法更改其交互性。");
  }
  msg.context.interactive = arg;
  reply.html("指令将" + (arg ? "" : "不") + "会在可交互 shell 运行。");
});

// Settings: Link previews
bot.command("setlinkpreviews", function (msg, reply, next) {
  var arg = utils.resolveBoolean(msg.args());
  if (arg === null)
    return reply.html("使用 /setlinkpreviews [yes|no] 控制输出中的链接是否展开。");

  msg.context.linkPreviews = arg;
  if (msg.context.command) msg.context.command.setLinkPreviews(arg);
  reply.html("输出中的链接将" + (arg ? "" : "不") + "会展开。");
});

// Settings: Other chat access
bot.command("grant", "revoke", function (msg, reply, next) {
  if (msg.context.id !== owner) return;
  var arg = msg.args(1)[0], id = parseInt(arg);
  if (!arg || isNaN(id))
    return reply.html("使用 %s 或 %s 控制这个ID能否对话。", "/grant <id>", "/revoke <id>");
  reply.reply(msg);
  if (msg.command === "grant") {
    granted[id] = true;
    reply.html("对话 %s 现在能够使用祂。 使用 /revoke 撤销权限.", id);
  } else {
    if (contexts[id] && contexts[id].command)
      return reply.html("指令运行时不能撤销对话权限");
    delete granted[id];
    delete contexts[id];
    reply.html("对话 %s 的权限被撤销。", id);
  }
});
bot.command("token", function (msg, reply, next) {
  if (msg.context.id !== owner) return;
  var token = utils.generateToken();
  tokens[token] = true;
  reply.disablePreview().html("生成一次性访问令牌。 以下链接可以用于访问对话:\n%s\n或者转发下面的消息: ", bot.link(token));
  reply.command(true, "start", token);
});

// Welcome message, help
bot.command("start", function (msg, reply, next) {
  if (msg.args() && msg.context.id === owner && Object.hasOwnProperty.call(tokens, msg.args())) {
    reply.html("令牌已被撤销。");
  } else {
    reply.html("欢迎! 使用 /run 来执行指令,或者恢复我的消息来发送输入。 /help 获取帮助。");
  }
});

bot.command("help", function (msg, reply, next) {
  reply.html(
    "使用 /run &lt;command&gt; 命令，我会为您执行它。在命令运行时，您可以：\n" +
    "\n" +
    "‣ 回复我的消息之一以向命令发送输入，或使用 /enter。\n" +
    "‣ 使用 /end 发送 EOF（Ctrl+D）给命令。\n" +
    "‣ 使用 /cancel 向进程组发送 SIGINT（Ctrl+C），或者您选择的信号。\n" +
    "‣ 使用 /kill 向根进程发送 SIGTERM，或者您选择的信号。\n" + 
    "‣ 对于图形应用程序，使用 /redraw 强制重新绘制屏幕。\n" +
    "‣ 使用 /type 或 /control 按键，/meta 以使用 Alt 键发送下一个键，或者使用 /keypad 显示特殊键盘。\n" + 
    "\n" +
    "您可以使用 /status 查看此聊天的当前状态和设置。使用 /env 操作环境，/cd 更改当前目录，/shell 查看或更改用于运行命令的 shell，以及使用 /resize 更改终端的大小。\n" +
    "\n" +
    "默认情况下，输出消息会静默发送（无声音），链接不会被展开。这可以通过 /setsilent 和 /setlinkpreviews 进行更改。注意：链接在状态行中永远不会被展开。\n" +
    "\n" +
    "<em>额外功能</em>\n" +
    "\n" +
    "使用 /upload &lt;file&gt;，我会将该文件发送给您。如果您回复该消息并上传文件给我，我会用您的文件覆盖它。\n" +
    "\n" +
    "您还可以使用 /file &lt;file&gt; 以文本消息形式显示文件的内容。这也允许您编辑文件，但您必须知道如何操作..."
  );
});




bot.command(function (msg, reply, next) {
  reply.reply(msg).text("无效的指令。");
});
