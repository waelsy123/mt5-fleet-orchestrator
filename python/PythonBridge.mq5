//+------------------------------------------------------------------+
//| PythonBridge.mq5 - File-based Python-to-MT5 bridge              |
//+------------------------------------------------------------------+
#property copyright "Python Bridge"
#property version   "1.00"

#include <Trade\Trade.mqh>

CTrade trade;

void OnInit()
{
   trade.SetExpertMagicNumber(123456);
   trade.SetDeviationInPoints(20);
   EventSetMillisecondTimer(200);  // Check every 200ms
   Print("PythonBridge EA started. Monitoring for commands...");
}

void OnTimer()
{
   if(!FileIsExist("command.txt"))
      return;

   int fh = FileOpen("command.txt", FILE_READ|FILE_TXT|FILE_ANSI);
   if(fh == INVALID_HANDLE)
      return;

   string line = FileReadString(fh);
   FileClose(fh);
   FileDelete("command.txt");

   if(StringLen(line) < 3)
      return;

   Print("Command received: ", line);
   ProcessCommand(line);
}

void ProcessCommand(string cmd)
{
   // Format: ACTION|SYMBOL|VOLUME|PRICE|SL|TP|COMMENT
   // Example: BUY|EURUSD|0.01|0|0|0|api-buy
   // Example: SELL|EURUSD|0.01|0|0|0|api-sell
   // Example: CLOSE|EURUSD|0|0|0|0|close-all
   // Example: INFO||||||| (account info)
   // Example: QUOTE|EURUSD||||| (get price)

   string parts[];
   int count = StringSplit(cmd, '|', parts);

   if(count < 1)
   {
      WriteResult("ERROR|Invalid command format");
      return;
   }

   string action = parts[0];

   if(action == "INFO")
   {
      if(!TerminalInfoInteger(TERMINAL_CONNECTED))
      {
         WriteResult("ERROR|Not connected to broker");
         return;
      }
      MqlTick tick;
      string symbol = (count > 1 && StringLen(parts[1]) > 0) ? parts[1] : "EURUSD";
      SymbolSelect(symbol, true);
      SymbolInfoTick(symbol, tick);

      string info = StringFormat("OK|login=%d|balance=%.2f|equity=%.2f|margin=%.2f|free_margin=%.2f|leverage=%d|server=%s|bid=%.5f|ask=%.5f",
         AccountInfoInteger(ACCOUNT_LOGIN),
         AccountInfoDouble(ACCOUNT_BALANCE),
         AccountInfoDouble(ACCOUNT_EQUITY),
         AccountInfoDouble(ACCOUNT_MARGIN),
         AccountInfoDouble(ACCOUNT_MARGIN_FREE),
         AccountInfoInteger(ACCOUNT_LEVERAGE),
         AccountInfoString(ACCOUNT_SERVER),
         tick.bid, tick.ask);
      WriteResult(info);
      return;
   }

   if(action == "QUOTE")
   {
      string symbol = (count > 1) ? parts[1] : "EURUSD";
      SymbolSelect(symbol, true);
      MqlTick tick;
      if(!SymbolInfoTick(symbol, tick))
      {
         WriteResult("ERROR|No tick for " + symbol);
         return;
      }
      WriteResult(StringFormat("OK|symbol=%s|bid=%.5f|ask=%.5f|time=%d", symbol, tick.bid, tick.ask, tick.time));
      return;
   }

   if(action == "BUY" || action == "SELL")
   {
      if(count < 3)
      {
         WriteResult("ERROR|Need at least ACTION|SYMBOL|VOLUME");
         return;
      }

      if(!TerminalInfoInteger(TERMINAL_CONNECTED))
      {
         WriteResult("ERROR|Not connected to broker");
         return;
      }

      if(!TerminalInfoInteger(TERMINAL_TRADE_ALLOWED))
      {
         // Try anyway - the EA-level permission might be separate
         Print("Warning: TERMINAL_TRADE_ALLOWED is false, but attempting trade anyway");
      }

      string symbol = parts[1];
      double volume = StringToDouble(parts[2]);
      double sl = (count > 4) ? StringToDouble(parts[4]) : 0;
      double tp = (count > 5) ? StringToDouble(parts[5]) : 0;
      string comment = (count > 6) ? parts[6] : "python-api";

      SymbolSelect(symbol, true);

      // Determine filling mode
      long filling = SymbolInfoInteger(symbol, SYMBOL_FILLING_MODE);
      if((filling & SYMBOL_FILLING_IOC) != 0)
         trade.SetTypeFilling(ORDER_FILLING_IOC);
      else if((filling & SYMBOL_FILLING_FOK) != 0)
         trade.SetTypeFilling(ORDER_FILLING_FOK);
      else
         trade.SetTypeFilling(ORDER_FILLING_RETURN);

      MqlTick tick;
      if(!SymbolInfoTick(symbol, tick) || tick.ask <= 0)
      {
         WriteResult("ERROR|No price for " + symbol);
         return;
      }

      bool ok;
      if(action == "BUY")
         ok = trade.Buy(volume, symbol, tick.ask, sl, tp, comment);
      else
         ok = trade.Sell(volume, symbol, tick.bid, sl, tp, comment);

      if(ok)
      {
         WriteResult(StringFormat("OK|action=%s|deal=%d|order=%d|price=%.5f|volume=%.2f",
            action, trade.ResultDeal(), trade.ResultOrder(), trade.ResultPrice(), trade.ResultVolume()));
      }
      else
      {
         WriteResult(StringFormat("ERROR|retcode=%d|comment=%s", trade.ResultRetcode(), trade.ResultComment()));
      }
      return;
   }

   if(action == "CLOSE")
   {
      string symbol = (count > 1) ? parts[1] : "";
      int closed = 0;
      for(int i = PositionsTotal() - 1; i >= 0; i--)
      {
         ulong ticket = PositionGetTicket(i);
         if(ticket == 0) continue;
         if(StringLen(symbol) > 0 && PositionGetString(POSITION_SYMBOL) != symbol)
            continue;
         if(trade.PositionClose(ticket))
            closed++;
      }
      WriteResult(StringFormat("OK|closed=%d", closed));
      return;
   }

   if(action == "POSITIONS")
   {
      string result = "OK|count=" + IntegerToString(PositionsTotal());
      for(int i = 0; i < PositionsTotal(); i++)
      {
         ulong ticket = PositionGetTicket(i);
         if(ticket == 0) continue;
         result += StringFormat("|pos=%d;symbol=%s;type=%s;volume=%.2f;price=%.5f;profit=%.2f;sl=%.5f;tp=%.5f",
            ticket,
            PositionGetString(POSITION_SYMBOL),
            (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY) ? "BUY" : "SELL",
            PositionGetDouble(POSITION_VOLUME),
            PositionGetDouble(POSITION_PRICE_OPEN),
            PositionGetDouble(POSITION_PROFIT),
            PositionGetDouble(POSITION_SL),
            PositionGetDouble(POSITION_TP));
      }
      WriteResult(result);
      return;
   }

   WriteResult("ERROR|Unknown action: " + action);
}

void WriteResult(string result)
{
   Print("Result: ", result);
   int fh = FileOpen("result.txt", FILE_WRITE|FILE_TXT|FILE_ANSI);
   if(fh != INVALID_HANDLE)
   {
      FileWriteString(fh, result);
      FileClose(fh);
   }
}

void OnDeinit(const int reason)
{
   EventKillTimer();
   Print("PythonBridge EA stopped.");
}

void OnTick() {}
