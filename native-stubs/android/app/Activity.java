package android.app;

import android.content.Context;
import android.os.Bundle;
import android.view.View;

public class Activity extends Context {
    protected void onCreate(Bundle state) {}
    protected void onDestroy() {}
    public void onBackPressed() {}
    public boolean requestWindowFeature(int featureId) { return true; }
    public void setContentView(View view) {}
}
