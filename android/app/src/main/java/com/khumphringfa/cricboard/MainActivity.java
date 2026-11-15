package com.khumphringfa.cricboard;

import android.app.Activity;
import android.os.Bundle;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.graphics.Color;
import android.graphics.Typeface;
import android.view.Gravity;
import android.view.WindowInsets;
import android.widget.*;
import androidx.browser.customtabs.CustomTabsIntent;

public final class MainActivity extends Activity {
    private static final String HOME = "https://cricboard.manas-tripura.workers.dev/";
    private int dp(int n) { return Math.round(n * getResources().getDisplayMetrics().density); }
    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        ScrollView scroll = new ScrollView(this);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER_HORIZONTAL);
        root.setPadding(dp(24), dp(48), dp(24), dp(24));
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            root.setPadding(dp(24), dp(48) + insets.getSystemWindowInsetTop(), dp(24), dp(24) + insets.getSystemWindowInsetBottom());
            return insets;
        });
        ImageView icon = new ImageView(this);
        icon.setImageResource(R.drawable.ic_cricboard);
        root.addView(icon, new LinearLayout.LayoutParams(dp(96), dp(96)));
        TextView title = new TextView(this);
        title.setText(R.string.app_name); title.setTextSize(34); title.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        title.setGravity(Gravity.CENTER); title.setTextColor(Color.rgb(15,23,42)); root.addView(title);
        TextView sub = new TextView(this); sub.setText(R.string.subtitle); sub.setTextSize(18); sub.setGravity(Gravity.CENTER); root.addView(sub);
        addButton(root, R.string.organizer, () -> open(HOME + "?manage=1"));
        addButton(root, R.string.spectator, () -> open(HOME + "?public=1"));
        addButton(root, R.string.share, () -> {
            Intent share = new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, HOME);
            startActivity(Intent.createChooser(share, getString(R.string.share)));
        });
        TextView note = new TextView(this); note.setText(R.string.note); note.setTextSize(15); note.setGravity(Gravity.CENTER);
        note.setPadding(0, dp(20), 0, 0); root.addView(note);
        scroll.addView(root); setContentView(scroll);
    }
    private void addButton(LinearLayout root, int label, Runnable action) {
        Button button = new Button(this); button.setText(label); button.setAllCaps(false);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, dp(56)); params.topMargin = dp(12);
        root.addView(button, params); button.setOnClickListener(v -> action.run());
    }
    private void open(String address) {
        Uri uri = Uri.parse(address);
        try { new CustomTabsIntent.Builder().setShowTitle(true).build().launchUrl(this, uri); }
        catch (ActivityNotFoundException e) {
            try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); }
            catch (ActivityNotFoundException unavailable) { Toast.makeText(this, R.string.no_browser, Toast.LENGTH_LONG).show(); }
        }
    }
}
