package android.webkit;

import android.content.Context;
import android.view.View;

public class WebView extends View {
    public WebView(Context context) {}
    public WebSettings getSettings() { return null; }
    public void setWebViewClient(WebViewClient client) {}
    public void loadUrl(String url) {}
    public boolean canGoBack() { return false; }
    public void goBack() {}
    public void destroy() {}
}
